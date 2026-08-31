import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApplicationsService } from './applications.service.js';
import { CandidateAuthGuard } from '../auth/candidate-auth.guard.js';

function asTrimmedString(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['key', 'url', 'cvUrl']) {
      if (typeof record[key] === 'string' && record[key].trim()) {
        return record[key].trim();
      }
    }
  }
  return undefined;
}

@Controller('applications')
@UseGuards(CandidateAuthGuard)
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get()
  list(@Req() req: any) {
    return this.applications.listForCandidate(req.candidate.id);
  }

  @Get(':id')
  get(@Req() req: any, @Param('id') id: string) {
    return this.applications.getForCandidate(req.candidate.id, id);
  }

  /**
   * Do not use a class-validator DTO here. Global ValidationPipe is
   * whitelist + forbidNonWhitelisted; a missing/non-string cvFileName
   * (or an extra form field) 400s before B2B ever sees the apply.
   */
  @Post()
  apply(@Req() req: any, @Body() body: Record<string, unknown>) {
    const raw = body && typeof body === 'object' ? body : {};
    const jobId = asTrimmedString(raw.jobId ?? raw.jobListingId);
    const cvUrl = asTrimmedString(raw.cvUrl ?? raw.key ?? raw.cvKey);
    if (!jobId) {
      throw new BadRequestException('jobId is required');
    }
    if (!cvUrl) {
      throw new BadRequestException('CV upload is required');
    }

    const cvFileName =
      asTrimmedString(raw.cvFileName ?? raw.fileName ?? raw.filename) ||
      cvUrl.split('/').pop()?.split('?')[0] ||
      'cv.pdf';

    return this.applications.apply(req.candidate.id, {
      jobId,
      name: asTrimmedString(raw.name ?? raw.fullName),
      phone: asTrimmedString(raw.phone),
      portfolioUrl: asTrimmedString(raw.portfolioUrl),
      coverLetter: asTrimmedString(raw.coverLetter),
      cvUrl,
      cvFileName,
    });
  }

  @Post('copy')
  copyFromB2b(@Req() req: any, @Body() body: Record<string, unknown>) {
    const jobId = asTrimmedString(
      body?.jobId ?? body?.jobListingId,
    );
    const b2bApplicantId = asTrimmedString(
      body?.b2bApplicantId ?? body?.applicantId ?? body?.id,
    );
    if (!jobId || !b2bApplicantId) {
      throw new BadRequestException('jobId and b2bApplicantId are required');
    }
    return this.applications.recordCopyFromB2b(req.candidate.id, {
      jobId,
      b2bApplicantId,
      status: asTrimmedString(body?.status),
    });
  }
}
