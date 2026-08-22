import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CandidateAuthGuard } from '../auth/candidate-auth.guard.js';
import { AssessmentsService } from './assessments.service.js';

@Controller('assessments')
@UseGuards(CandidateAuthGuard)
export class AssessmentsController {
  constructor(private readonly assessments: AssessmentsService) {}

  @Get()
  catalog() {
    return this.assessments.catalog();
  }

  @Get('me')
  mine(@Req() req: any) {
    return this.assessments.listMine(req.candidate.id);
  }

  @Get(':skillKey')
  quiz(@Param('skillKey') skillKey: string) {
    return this.assessments.getQuiz(skillKey);
  }

  @Post(':skillKey/submit')
  submit(
    @Req() req: any,
    @Param('skillKey') skillKey: string,
    @Body() body: { answers?: Record<string, number> },
  ) {
    return this.assessments.submit(req.candidate.id, skillKey, body.answers ?? {});
  }
}
