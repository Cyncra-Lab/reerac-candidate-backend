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

  /**
   * Candidate-api authenticates the talent and forwards apply to B2B.
   * B2B is the hiring record (recruiter pipeline). This service only stores a
   * tracking copy after B2B returns an applicant id.
   */
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

    const cvUrl = dto.cvUrl.trim();
    const cvFileName =
      dto.cvFileName?.trim() ||
      cvUrl.split('/').pop()?.split('?')[0] ||
      'cv.pdf';

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

    const priorCopy = await this.prisma.application.findUnique({
      where: {
        candidateId_jobListingId: {
          candidateId,
          jobListingId: listing.id,
        },
      },
    });

    const b2bApplicant = await this.createOnB2b({
      jobId: listing.b2bJobId,
      externalCandidateId: candidate.id,
      name: `${candidate.firstName} ${candidate.lastName}`.trim(),
      email: candidate.email,
      phone: dto.phone ?? candidate.phone ?? undefined,
      portfolioUrl: dto.portfolioUrl,
      coverLetter: dto.coverLetter,
      cvUrl,
      cvFileName,
    });

    const application = await this.upsertCandidateCopy({
      candidateId,
      jobListingId: listing.id,
      b2bApplicantId: b2bApplicant.id,
      status: mapB2bStatusToCandidate(
        b2bApplicant.status,
        b2bApplicant.cvScanStatus,
      ),
    });

    if (!priorCopy) {
      await this.afterFirstApply({
        candidateId,
        phone: dto.phone ?? candidate.phone,
        firstName: candidate.firstName,
        jobTitle: listing.title,
      });
    }

    return application;
  }

  private async createOnB2b(payload: {
    jobId: string;
    externalCandidateId: string;
    name: string;
    email: string;
    phone?: string;
    portfolioUrl?: string;
    coverLetter?: string;
    cvUrl: string;
    cvFileName: string;
  }): Promise<{
    id: string;
    status?: string;
    cvScanStatus?: string;
  }> {
    try {
      const b2bApplicant = await this.b2b.createApplication(payload);
      if (!b2bApplicant?.id) {
        throw new BadRequestException(
          'Hiring workspace did not return an application id',
        );
      }
      return b2bApplicant;
    } catch (err) {
      if (err instanceof BadRequestException || err instanceof NotFoundException) {
        throw err;
      }
      const axiosErr = err as {
        response?: {
          status?: number;
          data?: {
            message?: string | string[];
            error?: { message?: string | string[] };
          };
        };
        message?: string;
      };
      const status = axiosErr.response?.status;
      const raw =
        axiosErr.response?.data?.error?.message ||
        axiosErr.response?.data?.message ||
        axiosErr.message ||
        'Failed to submit application to hiring workspace';
      const message = Array.isArray(raw) ? raw.join(', ') : String(raw);
      if (status === 404) throw new NotFoundException(message);
      this.logger.error(`B2B createApplication failed: ${message}`);
      throw new BadRequestException(message);
    }
  }

  /** Projection for the candidate dashboard. Never the hiring source of truth. */
  private async upsertCandidateCopy(params: {
    candidateId: string;
    jobListingId: string;
    b2bApplicantId: string;
    status: CandidateApplicationStatus;
  }) {
    const byApplicant = await this.prisma.application.findUnique({
      where: { b2bApplicantId: params.b2bApplicantId },
      include: { jobListing: true },
    });
    if (byApplicant) {
      return this.prisma.application.update({
        where: { id: byApplicant.id },
        data: {
          status: params.status,
          lastSyncedAt: new Date(),
        },
        include: { jobListing: true },
      });
    }

    try {
      return await this.prisma.application.upsert({
        where: {
          candidateId_jobListingId: {
            candidateId: params.candidateId,
            jobListingId: params.jobListingId,
          },
        },
        create: {
          candidateId: params.candidateId,
          jobListingId: params.jobListingId,
          b2bApplicantId: params.b2bApplicantId,
          status: params.status,
        },
        update: {
          b2bApplicantId: params.b2bApplicantId,
          status: params.status,
          lastSyncedAt: new Date(),
        },
        include: { jobListing: true },
      });
    } catch (err) {
      this.logger.error(
        `B2B apply succeeded (${params.b2bApplicantId}) but candidate copy failed: ${(err as Error).message}`,
      );
      throw new BadRequestException(
        'Application was received by the hiring team, but your dashboard copy could not be saved. Refresh and check Applications.',
      );
    }
  }

  private async afterFirstApply(params: {
    candidateId: string;
    phone?: string | null;
    firstName: string;
    jobTitle: string;
  }) {
    if (params.phone?.trim()) {
      const phone = params.phone.trim();
      await this.prisma.whatsAppOptIn.upsert({
        where: { candidateId: params.candidateId },
        create: {
          candidateId: params.candidateId,
          phone,
          optedIn: true,
          community: true,
        },
        update: { phone, optedIn: true, community: true },
      });
      void this.handoffWhatsApp({
        candidateId: params.candidateId,
        phone,
        name: params.firstName,
        jobTitle: params.jobTitle,
      });
    }

    await this.prisma.notification
      .create({
        data: {
          candidateId: params.candidateId,
          type: 'WHATSAPP_COMMUNITY',
          title: 'Join the Reerac WhatsApp community',
          body: `You applied to ${params.jobTitle}. Message us on WhatsApp to join the free talent community for job updates.`,
          link: '/jobs',
        },
      })
      .catch((err) => {
        this.logger.warn(
          `Failed to create WhatsApp community notification: ${(err as Error).message}`,
        );
      });
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
    jobId?: string;
  }) {
    const seen = await this.prisma.processedEvent.findUnique({
      where: { eventId: params.eventId },
    });
    if (seen) return { skipped: true };

    let application = await this.prisma.application.findUnique({
      where: { b2bApplicantId: params.b2bApplicantId },
    });

    if (
      !application &&
      params.externalCandidateId &&
      params.b2bApplicantId &&
      params.jobId
    ) {
      try {
        const listing = await this.jobs.getById(params.jobId);
        application = await this.upsertCandidateCopy({
          candidateId: params.externalCandidateId,
          jobListingId: listing.id,
          b2bApplicantId: params.b2bApplicantId,
          status: mapB2bStatusToCandidate(params.status, params.cvScanStatus),
        });
      } catch (err) {
        this.logger.warn(
          `Could not create candidate copy from B2B event: ${(err as Error).message}`,
        );
      }
    } else if (application) {
      application = await this.prisma.application.update({
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
