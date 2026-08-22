import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JobsService } from './jobs.service.js';
import { CandidateAuthGuard } from '../auth/candidate-auth.guard.js';
import { AuthService } from '../auth/auth.service.js';

@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly auth: AuthService,
  ) {}

  private async optionalCandidateId(req: any): Promise<string | undefined> {
    try {
      const user = await this.auth.getSessionUser(req);
      const candidate = await this.auth.ensureCandidate(user);
      return candidate.id;
    } catch {
      return undefined;
    }
  }

  @Get()
  async list(
    @Req() req: any,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('workMode') workMode?: string,
    @Query('type') type?: string,
    @Query('location') location?: string,
    @Query('minSalary') minSalary?: string,
    @Query('minMatch') minMatch?: string,
    @Query('forYou') forYou?: string,
    @Query('sort') sort?: 'match' | 'recent',
  ) {
    const candidateId = await this.optionalCandidateId(req);
    return this.jobs.list({
      search,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
      workMode,
      type,
      location,
      minSalary: minSalary ? Number(minSalary) : undefined,
      minMatch: minMatch ? Number(minMatch) : undefined,
      forYou: forYou === '1' || forYou === 'true',
      sort,
      candidateId,
    });
  }

  @Get('saved')
  @UseGuards(CandidateAuthGuard)
  saved(@Req() req: any) {
    return this.jobs.listSaved(req.candidate.id);
  }

  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    const candidateId = await this.optionalCandidateId(req);
    return this.jobs.getById(id, candidateId);
  }

  @Post(':id/save')
  @UseGuards(CandidateAuthGuard)
  save(@Req() req: any, @Param('id') id: string) {
    return this.jobs.save(req.candidate.id, id);
  }

  @Delete(':id/save')
  @UseGuards(CandidateAuthGuard)
  unsave(@Req() req: any, @Param('id') id: string) {
    return this.jobs.unsave(req.candidate.id, id);
  }

  @Post('sync')
  @UseGuards(CandidateAuthGuard)
  sync() {
    return this.jobs.syncFromB2b();
  }
}
