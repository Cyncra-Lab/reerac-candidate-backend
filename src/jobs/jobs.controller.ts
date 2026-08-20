import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JobsService } from './jobs.service.js';
import { CandidateAuthGuard } from '../auth/candidate-auth.guard.js';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  list(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.jobs.list({
      search,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.jobs.getById(id);
  }

  @Post('sync')
  @UseGuards(CandidateAuthGuard)
  sync() {
    return this.jobs.syncFromB2b();
  }
}
