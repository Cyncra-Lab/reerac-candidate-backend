import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { MatchingService } from './matching.service.js';
import { CandidateAuthGuard } from '../auth/candidate-auth.guard.js';

@Controller('matches')
@UseGuards(CandidateAuthGuard)
export class MatchingController {
  constructor(private readonly matching: MatchingService) {}

  @Get()
  list(@Req() req: any) {
    return this.matching.topMatches(req.candidate.id);
  }

  @Get('job/:jobId')
  preview(@Req() req: any, @Param('jobId') jobId: string) {
    return this.matching.previewForJob(req.candidate.id, jobId);
  }

  @Post('refresh')
  refresh(@Req() req: any) {
    return this.matching.refreshForCandidate(req.candidate.id);
  }
}
