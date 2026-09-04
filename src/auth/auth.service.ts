import {
  Injectable,
  OnModuleInit,
  Logger,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { Request, Response as ExpressResponse } from 'express';
import { randomBytes } from 'crypto';
import { AppConfigService } from '../config/config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ACCESS_IDLE_SECONDS,
  betterAuthSessionOptions,
  nextAccessExpiry,
  parseCookieValue,
  REFRESH_COOKIE_NAME,
  refreshRemainingSeconds,
  serializeRefreshCookie,
  sessionTimeoutVerdict,
  shouldBumpActivity,
} from './session-policy.js';

@Injectable()
export class AuthService implements OnModuleInit {
  private auth: any;
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.auth = betterAuth({
      secret: this.config.betterAuthSecret,
      // Browser-facing origin (Next app). Auth is proxied at /api/candidate-auth.
      baseURL: this.config.betterAuthUrl,
      basePath: '/api/candidate-auth',
      trustedOrigins: [
        this.config.frontendUrl,
        this.config.betterAuthUrl,
        ...this.config.betterAuthTrustedOrigins,
      ],
      database: prismaAdapter(this.prisma, { provider: 'postgresql' }),
      ...(this.config.isGoogleOAuthConfigured
        ? {
            socialProviders: {
              google: {
                clientId: this.config.googleClientId as string,
                clientSecret: this.config.googleClientSecret as string,
              },
            },
          }
        : {}),
      emailAndPassword: { enabled: true },
      user: { modelName: 'auth_user' },
      session: {
        modelName: 'auth_session',
        expiresIn: betterAuthSessionOptions.expiresIn,
        updateAge: betterAuthSessionOptions.updateAge,
        cookieCache: {
          enabled: true,
          maxAge: 60,
        },
      },
      account: { modelName: 'auth_account' },
      verification: { modelName: 'auth_verification' },
    });
  }

  get handler() {
    return this.auth.handler;
  }

  private newOpaqueToken() {
    return randomBytes(32).toString('base64url');
  }

  private refreshCookieSecure() {
    return process.env.NODE_ENV === 'production';
  }

  private sessionUnauthorized(
    code: 'SESSION_IDLE' | 'SESSION_EXPIRED',
    message: string,
  ) {
    return new UnauthorizedException({ code, message });
  }

  private cookieHeader(req: Request): string | undefined {
    const raw = req.headers.cookie;
    return Array.isArray(raw) ? raw.join('; ') : raw;
  }

  appendRefreshCookie(
    res: ExpressResponse,
    refreshToken: string,
    lastActivityAt: Date,
  ) {
    res.appendHeader(
      'Set-Cookie',
      serializeRefreshCookie(
        refreshToken,
        refreshRemainingSeconds(lastActivityAt),
        this.refreshCookieSecure(),
      ),
    );
  }

  clearRefreshCookie(res: ExpressResponse) {
    res.appendHeader(
      'Set-Cookie',
      serializeRefreshCookie('', 0, this.refreshCookieSecure()),
    );
  }

  private async maybeBumpActivity(session: {
    id: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    if (!shouldBumpActivity(session.updatedAt)) return;
    const now = new Date();
    await this.prisma.auth_session.update({
      where: { id: session.id },
      data: {
        updatedAt: now,
        expiresAt: nextAccessExpiry(now),
      },
    });
  }

  async attachRefreshFromBetterAuthResponse(
    response: Response,
    res: ExpressResponse,
  ) {
    const setCookies =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [];
    const cookieHeader = setCookies
      .map((cookie) => cookie.split(';')[0])
      .filter(Boolean)
      .join('; ');
    if (!cookieHeader) return;

    try {
      const session = await this.auth.api.getSession({
        headers: new Headers({ cookie: cookieHeader }),
      });
      const token = (session?.session as { token?: string } | undefined)?.token;
      if (!token) return;
      const issued = await this.issueSessionTokens(token);
      this.appendRefreshCookie(
        res,
        issued.refreshToken,
        new Date(issued.lastActivityAt),
      );
    } catch (err) {
      this.logger.warn(
        `Failed to attach refresh cookie: ${(err as Error).message}`,
      );
    }
  }

  async issueSessionTokens(accessToken: string) {
    const session = await this.prisma.auth_session.findUnique({
      where: { token: accessToken },
    });
    if (!session) {
      throw new UnauthorizedException('No session');
    }
    if (sessionTimeoutVerdict(session) === 'expired') {
      await this.prisma.auth_session
        .delete({ where: { id: session.id } })
        .catch(() => undefined);
      throw this.sessionUnauthorized(
        'SESSION_EXPIRED',
        'Session expired. Please sign in again.',
      );
    }

    const now = new Date();
    const refreshToken = session.refreshToken ?? this.newOpaqueToken();
    await this.prisma.auth_session.update({
      where: { id: session.id },
      data: {
        refreshToken,
        updatedAt: now,
        expiresAt: nextAccessExpiry(now),
      },
    });

    return {
      token: accessToken,
      refreshToken,
      lastActivityAt: now.toISOString(),
      expiresIn: ACCESS_IDLE_SECONDS,
    };
  }

  async refreshSession(req: Request, res: ExpressResponse) {
    const bodyToken =
      req.body && typeof req.body.refreshToken === 'string'
        ? req.body.refreshToken
        : null;
    const refreshToken =
      parseCookieValue(this.cookieHeader(req), REFRESH_COOKIE_NAME) ||
      bodyToken;

    let row = refreshToken
      ? await this.prisma.auth_session.findUnique({
          where: { refreshToken },
        })
      : null;

    if (!row) {
      const ba = await this.auth.api.getSession({
        headers: req.headers as any,
      });
      const sessionId = (ba?.session as { id?: string } | undefined)?.id;
      if (sessionId) {
        row = await this.prisma.auth_session.findUnique({
          where: { id: sessionId },
        });
      }
    }

    if (!row) {
      this.clearRefreshCookie(res);
      throw this.sessionUnauthorized(
        'SESSION_EXPIRED',
        'Invalid refresh token',
      );
    }

    if (sessionTimeoutVerdict(row) === 'expired') {
      await this.prisma.auth_session
        .delete({ where: { id: row.id } })
        .catch(() => undefined);
      this.clearRefreshCookie(res);
      throw this.sessionUnauthorized(
        'SESSION_EXPIRED',
        'Refresh token expired. Please sign in again.',
      );
    }

    const now = new Date();
    const nextRefresh = this.newOpaqueToken();
    await this.prisma.auth_session.update({
      where: { id: row.id },
      data: {
        refreshToken: nextRefresh,
        updatedAt: now,
        expiresAt: nextAccessExpiry(now),
      },
    });
    this.appendRefreshCookie(res, nextRefresh, now);
    return { ok: true, expiresIn: ACCESS_IDLE_SECONDS };
  }

  forwardBetterAuthResponse(response: Response, res: ExpressResponse) {
    res.status(response.status);
    const frontendOrigin = this.config.frontendUrl.replace(/\/$/, '');
    const authPublic = this.config.betterAuthUrl.replace(/\/$/, '');

    const setCookies =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [];
    if (setCookies.length > 0) {
      for (const cookie of setCookies) {
        res.appendHeader('Set-Cookie', cookie);
      }
    } else {
      const combined = response.headers.get('set-cookie');
      if (combined) res.appendHeader('Set-Cookie', combined);
    }

    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') return;
      if (key.toLowerCase() === 'location') {
        // Never send the browser to the raw Railway host for auth.
        let loc = value;
        loc = loc.replace(
          /https?:\/\/[^/]+\/api\/auth/gi,
          `${frontendOrigin}/api/candidate-auth`,
        );
        if (authPublic && loc.startsWith(authPublic + '/api/auth')) {
          loc = loc.replace(
            authPublic + '/api/auth',
            `${frontendOrigin}/api/candidate-auth`,
          );
        }
        res.setHeader(key, loc);
        return;
      }
      res.setHeader(key, value);
    });
  }

  async getSessionUser(req: Request) {
    const session = await this.auth.api.getSession({
      headers: req.headers as any,
    });
    if (!session?.user) {
      await this.throwIdleIfRefreshable(req);
      throw new UnauthorizedException('Not authenticated');
    }

    const sessionId = (session.session as { id?: string } | undefined)?.id;
    const sessionToken = (session.session as { token?: string } | undefined)
      ?.token;
    const row = sessionId
      ? await this.prisma.auth_session.findUnique({ where: { id: sessionId } })
      : sessionToken
        ? await this.prisma.auth_session.findUnique({
            where: { token: sessionToken },
          })
        : null;

    if (!row) {
      await this.throwIdleIfRefreshable(req);
      throw new UnauthorizedException('Not authenticated');
    }

    const verdict = sessionTimeoutVerdict(row);
    if (verdict === 'expired') {
      await this.prisma.auth_session
        .delete({ where: { id: row.id } })
        .catch(() => undefined);
      throw this.sessionUnauthorized(
        'SESSION_EXPIRED',
        'Session expired. Please sign in again.',
      );
    }
    if (verdict === 'idle') {
      throw this.sessionUnauthorized(
        'SESSION_IDLE',
        'Access expired due to inactivity',
      );
    }

    await this.maybeBumpActivity(row);
    return session.user as { id: string; email: string; name: string };
  }

  private async throwIdleIfRefreshable(req: Request) {
    const refreshToken = parseCookieValue(
      this.cookieHeader(req),
      REFRESH_COOKIE_NAME,
    );
    if (!refreshToken) return;
    const row = await this.prisma.auth_session.findUnique({
      where: { refreshToken },
    });
    if (row && sessionTimeoutVerdict(row) !== 'expired') {
      throw this.sessionUnauthorized(
        'SESSION_IDLE',
        'Access expired due to inactivity',
      );
    }
  }

  /**
   * Upsert talent identity for a local Better Auth user.
   * Claims SHADOW (pre-signup / migrated) rows by email.
   */
  async ensureCandidate(authUser: {
    id: string;
    email: string;
    name: string;
    firstName?: string;
    lastName?: string;
  }) {
    const email = authUser.email.toLowerCase().trim();
    const parts = (authUser.name || '').trim().split(/\s+/);
    const firstName = authUser.firstName || parts[0] || 'Candidate';
    const lastName =
      authUser.lastName || parts.slice(1).join(' ') || '';

    const byAuth = await this.prisma.candidate.findUnique({
      where: { authUserId: authUser.id },
    });
    if (byAuth) {
      if (byAuth.accountStatus === 'SUSPENDED') {
        throw new UnauthorizedException({
          code: 'ACCOUNT_SUSPENDED',
          message:
            'This candidate account has been suspended. Contact support.',
        });
      }
      const data: {
        email?: string;
        firstName?: string;
        lastName?: string;
        accountStatus?: 'ACTIVE';
      } = {};
      if (byAuth.email !== email) data.email = email;
      if (!byAuth.firstName && firstName) data.firstName = firstName;
      if (!byAuth.lastName && lastName) data.lastName = lastName;
      if (byAuth.accountStatus === 'SHADOW') data.accountStatus = 'ACTIVE';
      if (Object.keys(data).length === 0) return byAuth;
      return this.prisma.candidate.update({
        where: { id: byAuth.id },
        data,
      });
    }

    const byEmail = await this.prisma.candidate.findUnique({
      where: { email },
    });

    if (byEmail) {
      if (byEmail.accountStatus === 'SUSPENDED') {
        throw new UnauthorizedException({
          code: 'ACCOUNT_SUSPENDED',
          message:
            'This candidate account has been suspended. Contact support.',
        });
      }
      if (byEmail.authUserId && byEmail.authUserId !== authUser.id) {
        throw new ConflictException(
          'An account already exists for this email. Sign in instead.',
        );
      }

      // Claim SHADOW or unlinked row → ACTIVE
      return this.prisma.candidate.update({
        where: { id: byEmail.id },
        data: {
          authUserId: authUser.id,
          accountStatus: 'ACTIVE',
          firstName: byEmail.firstName || firstName,
          lastName: byEmail.lastName || lastName,
        },
      });
    }

    return this.prisma.candidate.create({
      data: {
        authUserId: authUser.id,
        email,
        firstName,
        lastName,
        accountStatus: 'ACTIVE',
        source: 'SIGNUP',
        profile: { create: {} },
      },
    });
  }
}
