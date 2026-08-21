import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { ApplicationsService } from './applications.service.js';
import { CandidateAuthGuard } from '../auth/candidate-auth.guard.js';

class ApplyDto {
  @IsString()
  jobId!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  portfolioUrl?: string;

  @IsOptional()
  @IsString()
  coverLetter?: string;

  /** S3 object key or absolute URL returned from CV upload. */
  @IsString()
  cvUrl!: string;

  @IsOptional()
  @IsString()
  cvFileName?: string;
}

@Controller('applications')
@UseGuards(CandidateAuthGuard)
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get()
  list(@Req() req: any) {
    return this.applications.listForCandidate(req.candidate.id);
  }

  @Post()
  apply(@Req() req: any, @Body() dto: ApplyDto) {
    return this.applications.apply(req.candidate.id, dto);
  }
}
