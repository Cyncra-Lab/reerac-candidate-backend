import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CandidateAuthGuard } from '../auth/candidate-auth.guard.js';
import { ToolsService } from './tools.service.js';

class CoverLetterDto {
  @IsString()
  jobId!: string;
}

class CoachAttachmentDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsString()
  @MaxLength(120)
  mime!: string;

  @IsIn(['image', 'file'])
  kind!: 'image' | 'file';

  @IsOptional()
  @IsString()
  @MaxLength(350_000)
  previewUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  textExcerpt?: string;
}

class CoachDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  message?: string;

  @IsOptional()
  @IsString()
  threadId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CoachAttachmentDto)
  attachments?: CoachAttachmentDto[];
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

  @Get('coach/threads')
  coachThreads(@Req() req: any) {
    return this.tools.listCoachThreads(req.candidate.id);
  }

  @Post('coach/threads')
  createCoachThread(@Req() req: any) {
    return this.tools.createCoachThread(req.candidate.id);
  }

  @Get('coach')
  coachThread(@Req() req: any, @Query('threadId') threadId?: string) {
    return this.tools.getCoachThread(req.candidate.id, threadId);
  }

  @Post('coach')
  coach(@Req() req: any, @Body() dto: CoachDto) {
    return this.tools.coach(req.candidate.id, dto.message ?? '', {
      threadId: dto.threadId,
      attachments: dto.attachments,
    });
  }
}
