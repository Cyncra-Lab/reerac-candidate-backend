import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';

/**
 * Authenticates candidates via local Better Auth cookie session only.
 * B2B Bearer tokens are intentionally not accepted (full B2C isolation).
 */
@Injectable()
export class CandidateAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    try {
      const user = await this.auth.getSessionUser(req);
      const candidate = await this.auth.ensureCandidate(user);
      req.authUser = user;
      req.candidate = candidate;
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Not authenticated');
    }
  }
}
