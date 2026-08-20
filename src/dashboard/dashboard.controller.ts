import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service.js';
import { CandidateAuthGuard } from '../auth/candidate-auth.guard.js';

@Controller('dashboard')
@UseGuards(CandidateAuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  home(@Req() req: any) {
    return this.dashboard.getHome(req.candidate.id);
  }
}
