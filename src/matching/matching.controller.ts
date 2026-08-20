import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
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

  @Post('refresh')
  refresh(@Req() req: any) {
    return this.matching.refreshForCandidate(req.candidate.id);
  }
}
