import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { B2bClientService } from '../b2b/b2b-client.service.js';

@Injectable()
export class CandidateAuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly b2b: B2bClientService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header = String(req.headers.authorization ?? '');
    const bearer = header.startsWith('Bearer ')
      ? header.slice(7).trim()
      : '';

    // Preferred: shared platform (B2B) session token from /login /signup.
    if (bearer) {
      const platformUser = await this.b2b.resolveBearerUser(bearer);
      if (platformUser) {
        const candidate = await this.auth.ensureCandidate({
          id: platformUser.authUserId,
          email: platformUser.email,
          name: platformUser.name,
          firstName: platformUser.firstName,
          lastName: platformUser.lastName,
        });
        req.authUser = {
          id: platformUser.authUserId,
          email: platformUser.email,
          name: platformUser.name,
        };
        req.candidate = candidate;
        req.platformRole = platformUser.role;
        return true;
      }
    }

    // Legacy local candidate-api cookie session (migration fallback).
    try {
      const user = await this.auth.getSessionUser(req);
      const candidate = await this.auth.ensureCandidate(user);
      req.authUser = user;
      req.candidate = candidate;
      return true;
    } catch {
      throw new UnauthorizedException('Not authenticated');
    }
  }
}
