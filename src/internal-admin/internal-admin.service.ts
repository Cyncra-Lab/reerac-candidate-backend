import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CandidateAccountStatus, PaymentSku, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

const AUTOMATION_KEYS = [
  'LOW_CV_SCORE',
  'MOCK_LAPSED',
  'PLACED_REENGAGE',
  'MATCH_DIGEST_WEEKLY',
  'MATCH_DIGEST_DAILY',
] as const;

@Injectable()
export class InternalAdminService {
  constructor(private readonly prisma: PrismaService) {}

  health() {
    return {
      ok: true,
      service: 'candidate-api-internal-admin',
      at: new Date().toISOString(),
    };
  }

  async overview() {
    const [
      candidatesTotal,
      candidatesActive,
      candidatesSuspended,
      candidatesShadow,
      applicationsTotal,
      mockInterviewsTotal,
      paymentsPaid,
      entitlementsActive,
    ] = await Promise.all([
      this.prisma.candidate.count(),
      this.prisma.candidate.count({
        where: { accountStatus: CandidateAccountStatus.ACTIVE },
      }),
      this.prisma.candidate.count({
        where: { accountStatus: CandidateAccountStatus.SUSPENDED },
      }),
      this.prisma.candidate.count({
        where: { accountStatus: CandidateAccountStatus.SHADOW },
      }),
      this.prisma.application.count(),
      this.prisma.mockInterviewSession.count(),
      this.prisma.payment.count({ where: { status: 'PAID' } }),
      this.prisma.entitlement.count({ where: { remaining: { gt: 0 } } }),
    ]);

    const recentCandidates = await this.prisma.candidate.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        accountStatus: true,
        createdAt: true,
      },
    });

    return {
      candidatesTotal,
      candidatesActive,
      candidatesSuspended,
      candidatesShadow,
      applicationsTotal,
      mockInterviewsTotal,
      paymentsPaid,
      entitlementsActive,
      recentCandidates,
    };
  }

  async listCandidates(query: {
    page?: number;
    limit?: number;
    search?: string;
    accountStatus?: CandidateAccountStatus;
  }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;
    const where: Prisma.CandidateWhereInput = {};
    if (query.accountStatus) where.accountStatus = query.accountStatus;
    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { email: { contains: term, mode: 'insensitive' } },
        { firstName: { contains: term, mode: 'insensitive' } },
        { lastName: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term, mode: 'insensitive' } },
        { roleInterest: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.candidate.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          roleInterest: true,
          accountStatus: true,
          lifecycleEmailOptIn: true,
          verifiedAt: true,
          visibilityBoostUntil: true,
          suspendedAt: true,
          createdAt: true,
          _count: {
            select: {
              applications: true,
              entitlements: true,
              coachThreads: true,
            },
          },
        },
      }),
      this.prisma.candidate.count({ where }),
    ]);

    return {
      data: data.map((c) => ({
        id: c.id,
        email: c.email,
        firstName: c.firstName,
        lastName: c.lastName,
        phone: c.phone,
        roleInterest: c.roleInterest,
        accountStatus: c.accountStatus,
        lifecycleEmailOptIn: c.lifecycleEmailOptIn,
        verifiedAt: c.verifiedAt,
        visibilityBoostUntil: c.visibilityBoostUntil,
        suspendedAt: c.suspendedAt,
        createdAt: c.createdAt,
        applicationCount: c._count.applications,
        entitlementCount: c._count.entitlements,
        coachThreadCount: c._count.coachThreads,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async getCandidate(id: string) {
    const candidate = await this.prisma.candidate.findUnique({
      where: { id },
      include: {
        profile: true,
        entitlements: true,
        payments: { orderBy: { createdAt: 'desc' }, take: 20 },
        applications: {
          orderBy: { appliedAt: 'desc' },
          take: 20,
          include: {
            jobListing: {
              select: {
                id: true,
                title: true,
                companyName: true,
                status: true,
              },
            },
          },
        },
        _count: {
          select: {
            coachThreads: true,
            mockSessions: true,
            cvAssets: true,
          },
        },
      },
    });
    if (!candidate) throw new NotFoundException('Candidate not found');
    return candidate;
  }

  async setCandidateStatus(
    id: string,
    accountStatus: 'ACTIVE' | 'SUSPENDED',
    reason?: string,
  ) {
    const candidate = await this.prisma.candidate.findUnique({ where: { id } });
    if (!candidate) throw new NotFoundException('Candidate not found');
    if (candidate.accountStatus === 'SHADOW' && accountStatus === 'ACTIVE') {
      throw new BadRequestException('Cannot activate a SHADOW candidate');
    }

    const updated = await this.prisma.candidate.update({
      where: { id },
      data:
        accountStatus === 'SUSPENDED'
          ? {
              accountStatus: CandidateAccountStatus.SUSPENDED,
              suspendedAt: new Date(),
              suspendReason: reason?.trim() || null,
            }
          : {
              accountStatus: CandidateAccountStatus.ACTIVE,
              suspendedAt: null,
              suspendReason: null,
            },
    });

    if (accountStatus === 'SUSPENDED' && candidate.authUserId) {
      await this.prisma.auth_session.deleteMany({
        where: { userId: candidate.authUserId },
      });
    }

    return updated;
  }

  async clearSessions(id: string) {
    const candidate = await this.prisma.candidate.findUnique({ where: { id } });
    if (!candidate) throw new NotFoundException('Candidate not found');
    if (!candidate.authUserId) {
      return { cleared: 0 };
    }
    const result = await this.prisma.auth_session.deleteMany({
      where: { userId: candidate.authUserId },
    });
    return { cleared: result.count };
  }

  async resetTrials(id: string) {
    const candidate = await this.prisma.candidate.findUnique({ where: { id } });
    if (!candidate) throw new NotFoundException('Candidate not found');
    return this.prisma.candidate.update({
      where: { id },
      data: {
        cvTrialUsedAt: null,
        mockTrialUsedAt: null,
        coverLetterTrialUsedAt: null,
        coachTrialUsedAt: null,
      },
    });
  }

  async adjustEntitlement(
    id: string,
    sku: PaymentSku,
    remaining: number,
    expiresAt?: string | null,
  ) {
    if (!Number.isFinite(remaining) || remaining < 0) {
      throw new BadRequestException('remaining must be >= 0');
    }
    const candidate = await this.prisma.candidate.findUnique({ where: { id } });
    if (!candidate) throw new NotFoundException('Candidate not found');

    return this.prisma.entitlement.upsert({
      where: { candidateId_sku: { candidateId: id, sku } },
      create: {
        candidateId: id,
        sku,
        remaining,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
      update: {
        remaining,
        expiresAt: expiresAt === undefined ? undefined : expiresAt ? new Date(expiresAt) : null,
      },
    });
  }

  async setVerification(id: string, verified: boolean) {
    const candidate = await this.prisma.candidate.findUnique({ where: { id } });
    if (!candidate) throw new NotFoundException('Candidate not found');
    return this.prisma.candidate.update({
      where: { id },
      data: { verifiedAt: verified ? new Date() : null },
    });
  }

  async setVisibilityBoost(id: string, until: string | null) {
    const candidate = await this.prisma.candidate.findUnique({ where: { id } });
    if (!candidate) throw new NotFoundException('Candidate not found');
    return this.prisma.candidate.update({
      where: { id },
      data: { visibilityBoostUntil: until ? new Date(until) : null },
    });
  }

  async wipeCoachThreads(id: string) {
    const candidate = await this.prisma.candidate.findUnique({ where: { id } });
    if (!candidate) throw new NotFoundException('Candidate not found');
    const result = await this.prisma.coachThread.deleteMany({
      where: { candidateId: id },
    });
    return { deleted: result.count };
  }

  async listMarketingAudience(query: {
    limit?: number;
    accountStatus?: CandidateAccountStatus;
    roleInterest?: string;
    optInOnly?: boolean;
  }) {
    const limit = Math.min(query.limit ?? 500, 500);
    const where: Prisma.CandidateWhereInput = {
      accountStatus: query.accountStatus ?? CandidateAccountStatus.ACTIVE,
      email: { not: '' },
    };
    if (query.optInOnly !== false) {
      where.lifecycleEmailOptIn = true;
    }
    if (query.roleInterest?.trim()) {
      where.roleInterest = {
        contains: query.roleInterest.trim(),
        mode: 'insensitive',
      };
    }

    const [total, rows] = await Promise.all([
      this.prisma.candidate.count({ where }),
      this.prisma.candidate.findMany({
        where,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      }),
    ]);

    return {
      total,
      capped: Math.min(total, limit),
      recipients: rows.map((r) => ({
        externalId: r.id,
        email: r.email,
        name: `${r.firstName} ${r.lastName}`.trim(),
        side: 'B2C' as const,
      })),
    };
  }

  async listPayments(query: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
  }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;
    const where: Prisma.PaymentWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { paystackRef: { contains: term, mode: 'insensitive' } },
        {
          candidate: {
            OR: [
              { email: { contains: term, mode: 'insensitive' } },
              { firstName: { contains: term, mode: 'insensitive' } },
              { lastName: { contains: term, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          candidate: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async markPaymentRefunded(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'REFUNDED' },
    });
  }

  async listJobListings(query: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    hidden?: boolean;
  }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;
    const where: Prisma.JobListingWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.hidden === true) where.hiddenAt = { not: null };
    if (query.hidden === false) where.hiddenAt = null;
    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { title: { contains: term, mode: 'insensitive' } },
        { companyName: { contains: term, mode: 'insensitive' } },
        { b2bJobId: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.jobListing.findMany({
        where,
        orderBy: { syncedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.jobListing.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async setJobListingHidden(id: string, hidden: boolean) {
    const listing = await this.prisma.jobListing.findUnique({ where: { id } });
    if (!listing) throw new NotFoundException('Job listing not found');
    return this.prisma.jobListing.update({
      where: { id },
      data: { hiddenAt: hidden ? new Date() : null },
    });
  }

  async listAutomations() {
    const logs = await this.prisma.notificationCampaignLog.groupBy({
      by: ['campaign'],
      _count: { _all: true },
      _max: { sentAt: true },
    });
    const byKey = Object.fromEntries(
      logs.map((l) => [
        l.campaign,
        { sentCount: l._count._all, lastSentAt: l._max.sentAt },
      ]),
    );

    const settings = await this.prisma.notificationAutomationSetting.findMany();
    const settingByKey = Object.fromEntries(
      settings.map((s) => [s.campaign, s]),
    );

    // Ensure rows exist for known keys
    for (const key of AUTOMATION_KEYS) {
      if (!settingByKey[key]) {
        const created = await this.prisma.notificationAutomationSetting.upsert({
          where: { campaign: key },
          create: { campaign: key, enabled: true },
          update: {},
        });
        settingByKey[key] = created;
      }
    }

    return AUTOMATION_KEYS.map((key) => ({
      key,
      enabled: settingByKey[key]?.enabled ?? true,
      sentCount: byKey[key]?.sentCount ?? 0,
      lastSentAt: byKey[key]?.lastSentAt ?? null,
      updatedAt: settingByKey[key]?.updatedAt ?? null,
    }));
  }

  async setAutomationEnabled(
    campaign: string,
    enabled: boolean,
    updatedBy?: string,
  ) {
    if (!(AUTOMATION_KEYS as readonly string[]).includes(campaign)) {
      throw new BadRequestException(`Unknown automation: ${campaign}`);
    }
    return this.prisma.notificationAutomationSetting.upsert({
      where: { campaign },
      create: { campaign, enabled, updatedBy: updatedBy ?? null },
      update: { enabled, updatedBy: updatedBy ?? null },
    });
  }

  getPricingCatalog() {
    // Mirror of candidate billing catalog (read-only for admin UI).
    return {
      currency: 'NGN',
      skus: [
        { sku: 'VISIBILITY_BOOST', amountNgn: 2500, label: 'Visibility boost' },
        {
          sku: 'PROFILE_VERIFICATION',
          amountNgn: 3500,
          label: 'Profile verification',
        },
        { sku: 'CV_OPTIMIZATION', amountNgn: 4500, label: 'CV optimization' },
        { sku: 'LINKEDIN_HANDOFF', amountNgn: 5000, label: 'LinkedIn handoff' },
        {
          sku: 'MOCK_INTERVIEW_PACK',
          amountNgn: 7500,
          label: 'Mock interview pack',
        },
        { sku: 'PREMIUM_WHATSAPP', amountNgn: 2000, label: 'Premium WhatsApp' },
        { sku: 'ALL_ACCESS', amountNgn: 15000, label: 'All-access' },
      ],
    };
  }

  async exportCandidatesCsv(limit = 5000) {
    const rows = await this.prisma.candidate.findMany({
      take: Math.min(limit, 10000),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        accountStatus: true,
        roleInterest: true,
        lifecycleEmailOptIn: true,
        createdAt: true,
      },
    });
    const header =
      'id,email,firstName,lastName,phone,accountStatus,roleInterest,lifecycleEmailOptIn,createdAt';
    const lines = rows.map((r) =>
      [
        r.id,
        r.email,
        r.firstName,
        r.lastName,
        r.phone ?? '',
        r.accountStatus,
        r.roleInterest ?? '',
        r.lifecycleEmailOptIn,
        r.createdAt.toISOString(),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    return [header, ...lines].join('\n');
  }
}
