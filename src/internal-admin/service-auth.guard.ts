import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AppConfigService } from '../config/config.service.js';

@Injectable()
export class ServiceAuthGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const header = req.headers.authorization as string | undefined;
    const token = header?.startsWith('Bearer ')
      ? header.slice('Bearer '.length).trim()
      : (req.headers['x-service-token'] as string | undefined);

    const expected = this.config.internalServiceToken;
    if (!token || token !== expected) {
      throw new UnauthorizedException('Invalid service token');
    }
    return true;
  }
}
