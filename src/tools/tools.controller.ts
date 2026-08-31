import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { CandidateAuthGuard } from '../auth/candidate-auth.guard.js';
import { ToolsService } from './tools.service.js';

class CoverLetterDto {
  @IsString()
  jobId!: string;
}

class CoachDto {
  @IsString()
  @MinLength(1)
  message!: string;
}

@Controller('tools')
@UseGuards(CandidateAuthGuard)
export class ToolsController {
  constructor(private readonly tools: ToolsService) {}

  @Get('status')
  status(@Req() req: any) {
    return this.tools.status(req.candidate.id);
  }

  @Post('cv-optimize')
  optimize(@Req() req: any) {
    return this.tools.optimizeCv(req.candidate.id);
  }

  @Post('cover-letter')
  coverLetter(@Req() req: any, @Body() dto: CoverLetterDto) {
    return this.tools.coverLetter(req.candidate.id, dto.jobId);
  }

  @Get('coach')
  coachThread(@Req() req: any) {
    return this.tools.getCoachThread(req.candidate.id);
  }

  @Post('coach')
  coach(@Req() req: any, @Body() dto: CoachDto) {
    return this.tools.coach(req.candidate.id, dto.message);
  }
}
