import {
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { CandidateAuthGuard } from '../auth/candidate-auth.guard.js';
import { AppConfigService } from '../config/config.service.js';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly config: AppConfigService,
  ) {}

  @Get()
  @UseGuards(CandidateAuthGuard)
  list(@Req() req: any) {
    return this.notifications.list(req.candidate.id);
  }

  @Patch(':id/read')
  @UseGuards(CandidateAuthGuard)
  markRead(@Req() req: any, @Param('id') id: string) {
    return this.notifications.markRead(req.candidate.id, id);
  }

  @Post('unsubscribe')
  @UseGuards(CandidateAuthGuard)
  unsubscribe(@Req() req: any) {
    return this.notifications.setLifecycleEmailOptIn(req.candidate.id, false);
  }

  @Post('subscribe')
  @UseGuards(CandidateAuthGuard)
  subscribe(@Req() req: any) {
    return this.notifications.setLifecycleEmailOptIn(req.candidate.id, true);
  }

  /** Ops/cron trigger for lifecycle campaigns. Requires LIFECYCLE_CRON_SECRET. */
  @Post('lifecycle/run')
  runLifecycle(@Headers('x-cron-secret') secret?: string) {
    const expected = this.config.lifecycleCronSecret;
    if (!expected || secret !== expected) {
      throw new UnauthorizedException('Invalid cron secret');
    }
    return this.notifications.runLifecycleCampaigns();
  }
}
