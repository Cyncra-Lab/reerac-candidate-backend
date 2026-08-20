import {
  Injectable,
  OnModuleInit,
  Logger,
  UnauthorizedException,
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
      baseURL: this.config.betterAuthUrl,
      trustedOrigins: [
        this.config.frontendUrl,
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
    response.headers.forEach((value, key) => {
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
   * `id` is the candidate-api Better Auth user id.
   */
  async ensureCandidate(authUser: {
    id: string;
    email: string;
    name: string;
    firstName?: string;
    lastName?: string;
  }) {
    const email = authUser.email.toLowerCase();
    const parts = (authUser.name || '').trim().split(/\s+/);
    const firstName = authUser.firstName || parts[0] || 'Candidate';
    const lastName =
      authUser.lastName || parts.slice(1).join(' ') || '';

    const byAuth = await this.prisma.candidate.findUnique({
      where: { authUserId: authUser.id },
    });
    if (byAuth) {
      if (byAuth.email !== email) {
        return this.prisma.candidate.update({
          where: { id: byAuth.id },
          data: { email, firstName, lastName },
        });
      }
      return byAuth;
    }

    const byEmail = await this.prisma.candidate.findFirst({
      where: { email },
    });
    if (byEmail) {
      return this.prisma.candidate.update({
        where: { id: byEmail.id },
        data: {
          authUserId: authUser.id,
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
        profile: { create: {} },
      },
    });
  }
}
