import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsInt, IsString, Min } from 'class-validator';
import { MockInterviewsService } from './mock-interviews.service.js';
import { CandidateAuthGuard } from '../auth/candidate-auth.guard.js';

class StartMockDto {
  @IsString()
  roleTitle!: string;
}

class SubmitTurnDto {
  @IsInt()
  @Min(1)
  order!: number;

  @IsString()
  answer!: string;
}

@Controller('mock-interviews')
@UseGuards(CandidateAuthGuard)
export class MockInterviewsController {
  constructor(private readonly mocks: MockInterviewsService) {}

  @Get()
  list(@Req() req: any) {
    return this.mocks.list(req.candidate.id);
  }

  @Post()
  start(@Req() req: any, @Body() dto: StartMockDto) {
    return this.mocks.start(req.candidate.id, dto.roleTitle);
  }

  @Post(':id/turns')
  submit(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: SubmitTurnDto,
  ) {
    return this.mocks.submitTurn(req.candidate.id, id, dto);
  }
}
