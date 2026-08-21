import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CandidateApplicationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { B2bClientService } from '../b2b/b2b-client.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import { AppConfigService } from '../config/config.service.js';
import axios from 'axios';

export function mapB2bStatusToCandidate(
  status: string,
  cvScanStatus?: string,
): CandidateApplicationStatus {
  if (cvScanStatus === 'SCANNING') return 'SCREENING';
  switch (status) {
    case 'NEW':
      return 'IN_REVIEW';
    case 'INTERVIEW_SCHEDULED':
      return 'IN_PROCESS';
    case 'INTERVIEW_COMPLETE':
      return 'INTERVIEWED';
    case 'SHORTLISTED':
      return 'SHORTLISTED';
    case 'HIRED':
      return 'HIRED';
    case 'REJECTED':
      return 'NOT_SELECTED';
    default:
      return 'APPLIED';
  }
}

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly b2b: B2bClientService,
    private readonly jobs: JobsService,
    private readonly config: AppConfigService,
  ) {}

  async apply(
    candidateId: string,
    dto: {
      jobId: string;
      name?: string;
      phone?: string;
      portfolioUrl?: string;
      coverLetter?: string;
      cvUrl: string;
      cvFileName?: string;
    },
  ) {
    let candidate = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
    });
    if (!candidate) throw new NotFoundException('Candidate not found');

    if (!dto.cvUrl?.trim()) {
      throw new BadRequestException('CV upload is required');
    }

    const cvFileName =
      dto.cvFileName?.trim() ||
      dto.cvUrl.split('/').pop()?.split('?')[0] ||
      'cv.pdf';

    // Keep profile in sync with the apply form (name/phone may have been edited).
    if (dto.name?.trim() || dto.phone?.trim()) {
      const parts = (dto.name ?? '').trim().split(/\s+/).filter(Boolean);
      const firstName = parts[0] || candidate.firstName;
      const lastName =
        parts.length > 1 ? parts.slice(1).join(' ') : candidate.lastName;
      candidate = await this.prisma.candidate.update({
        where: { id: candidateId },
        data: {
          ...(dto.name?.trim() ? { firstName, lastName } : {}),
          ...(dto.phone?.trim() ? { phone: dto.phone.trim() } : {}),
        },
      });
    }

    const listing = await this.jobs.getById(dto.jobId);
    const existing = await this.prisma.application.findUnique({
      where: {
        candidateId_jobListingId: {
          candidateId,
          jobListingId: listing.id,
        },
      },
      include: { jobListing: true },
    });
    if (existing) {
      // Idempotent: treat re-submit after a successful apply as success.
      return existing;
    }

    let b2bApplicant: { id: string };
    try {
      b2bApplicant = await this.b2b.createApplication({
        jobId: listing.b2bJobId,
        externalCandidateId: candidate.id,
        name: `${candidate.firstName} ${candidate.lastName}`.trim(),
        email: candidate.email,
        phone: dto.phone ?? candidate.phone ?? undefined,
        portfolioUrl: dto.portfolioUrl,
        coverLetter: dto.coverLetter,
        cvUrl: dto.cvUrl,
        cvFileName,
      });
    } catch (err) {
      const axiosErr = err as {
        response?: { status?: number; data?: { message?: string; error?: { message?: string } } };
        message?: string;
      };
      const status = axiosErr.response?.status;
      const message =
        axiosErr.response?.data?.error?.message ||
        axiosErr.response?.data?.message ||
        axiosErr.message ||
        'Failed to submit application to hiring workspace';
      if (status === 400) throw new BadRequestException(message);
      if (status === 404) throw new NotFoundException(message);
      this.logger.error(`B2B createApplication failed: ${message}`);
      throw new BadRequestException(message);
    }

    if (!b2bApplicant?.id) {
      throw new BadRequestException(
        'Hiring workspace did not return an application id',
      );
    }

    const application = await this.prisma.application.create({
      data: {
        candidateId,
        jobListingId: listing.id,
        b2bApplicantId: b2bApplicant.id,
        status: 'APPLIED',
      },
      include: { jobListing: true },
    });

    if (dto.phone || candidate.phone) {
      const phone = (dto.phone ?? candidate.phone)!.trim();
      await this.prisma.whatsAppOptIn.upsert({
        where: { candidateId },
        create: { candidateId, phone, optedIn: true, community: true },
        update: { phone, optedIn: true, community: true },
      });
      void this.handoffWhatsApp({
        candidateId,
        phone,
        name: candidate.firstName,
        jobTitle: listing.title,
      });
    }

    await this.prisma.notification.create({
      data: {
        candidateId,
        type: 'WHATSAPP_COMMUNITY',
        title: 'Join the Reerac WhatsApp community',
        body: `You applied to ${listing.title}. Message us on WhatsApp to join the free talent community for job updates.`,
        link: '/jobs',
      },
    }).catch((err) => {
      this.logger.warn(
        `Failed to create WhatsApp community notification: ${(err as Error).message}`,
      );
    });

    return application;
  }

  private async handoffWhatsApp(payload: {
    candidateId: string;
    phone: string;
    name: string;
    jobTitle: string;
  }) {
    const url = this.config.whatsappHandoffWebhookUrl;
    if (!url) {
      this.logger.debug('WhatsApp handoff webhook not configured');
      return;
    }
    try {
      await axios.post(url, {
        event: 'candidate.post_apply',
        ...payload,
      });
    } catch (err) {
      this.logger.warn(`WhatsApp handoff failed: ${(err as Error).message}`);
    }
  }

  listForCandidate(candidateId: string) {
    return this.prisma.application.findMany({
      where: { candidateId },
      include: { jobListing: true },
      orderBy: { appliedAt: 'desc' },
    });
  }

  async applyStatusFromEvent(params: {
    eventId: string;
    b2bApplicantId: string;
    status: string;
    cvScanStatus?: string;
    externalCandidateId?: string;
  }) {
    const seen = await this.prisma.processedEvent.findUnique({
      where: { eventId: params.eventId },
    });
    if (seen) return { skipped: true };

    const application = await this.prisma.application.findFirst({
      where: {
        OR: [
          { b2bApplicantId: params.b2bApplicantId },
          ...(params.externalCandidateId
            ? [{ candidateId: params.externalCandidateId }]
            : []),
        ],
      },
    });

    if (application) {
      await this.prisma.application.update({
        where: { id: application.id },
        data: {
          status: mapB2bStatusToCandidate(params.status, params.cvScanStatus),
          lastSyncedAt: new Date(),
        },
      });
    }

    await this.prisma.processedEvent.create({
      data: {
        eventId: params.eventId,
        eventType: 'application.status.changed',
      },
    });

    return { updated: Boolean(application) };
  }
}
