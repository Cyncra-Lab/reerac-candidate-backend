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
import { AppConfigService } from '../config/config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

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
      session: { modelName: 'auth_session' },
      account: { modelName: 'auth_account' },
      verification: { modelName: 'auth_verification' },
    });
  }

  get handler() {
    return this.auth.handler;
  }

  forwardBetterAuthResponse(response: Response, res: ExpressResponse) {
    res.status(response.status);
    const frontendOrigin = this.config.frontendUrl.replace(/\/$/, '');
    const authPublic = this.config.betterAuthUrl.replace(/\/$/, '');
    response.headers.forEach((value, key) => {
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
      throw new UnauthorizedException('Not authenticated');
    }
    return session.user as { id: string; email: string; name: string };
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
      const data: {
        email?: string;
        firstName?: string;
        lastName?: string;
        accountStatus?: 'ACTIVE';
      } = {};
      if (byAuth.email !== email) data.email = email;
      if (!byAuth.firstName && firstName) data.firstName = firstName;
      if (!byAuth.lastName && lastName) data.lastName = lastName;
      if (byAuth.accountStatus !== 'ACTIVE') data.accountStatus = 'ACTIVE';
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
