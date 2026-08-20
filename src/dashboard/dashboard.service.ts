import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getHome(candidateId: string) {
    const [
      candidate,
      applications,
      latestScore,
      topMatches,
      entitlements,
      notifications,
    ] = await Promise.all([
      this.prisma.candidate.findUnique({
        where: { id: candidateId },
        select: { verifiedAt: true, visibilityBoostUntil: true },
      }),
      this.prisma.application.findMany({
        where: { candidateId },
        include: { jobListing: true },
        orderBy: { appliedAt: 'desc' },
      }),
      this.prisma.cvScore.findFirst({
        where: { candidateId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.matchScore.findMany({
        where: { candidateId },
        include: { jobListing: true },
        orderBy: { matchPercent: 'desc' },
        take: 5,
      }),
      this.prisma.entitlement.findMany({ where: { candidateId } }),
      this.prisma.notification.findMany({
        where: { candidateId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    const insights: string[] = [];
    if (!latestScore) {
      insights.push('Upload your CV to unlock your Overall CV Score.');
    } else if (latestScore.overallScore < 70) {
      insights.push(
        'Your CV score is below 70 — CV optimization can improve interview callbacks.',
      );
    }
    if (applications.length === 0) {
      insights.push('Browse open roles and apply to start tracking status here.');
    }
    const mockEntitlement = entitlements.find(
      (e) => e.sku === 'MOCK_INTERVIEW_PACK',
    );
    const allAccess = entitlements.find((e) => e.sku === 'ALL_ACCESS');
    if (
      (!mockEntitlement || mockEntitlement.remaining <= 0) &&
      (!allAccess || allAccess.remaining <= 0)
    ) {
      insights.push('Practice with AI mock interviews before your next live call.');
    }
    if (!candidate?.verifiedAt) {
      insights.push('Get Profile Verification to stand out to recruiters.');
    }

    const now = new Date();
    const visibilityBoostActive = Boolean(
      candidate?.visibilityBoostUntil && candidate.visibilityBoostUntil > now,
    );

    return {
      totals: {
        applications: applications.length,
        activeApplications: applications.filter(
          (a) => !['HIRED', 'NOT_SELECTED'].includes(a.status),
        ).length,
      },
      applications,
      overallCvScore: latestScore?.overallScore ?? null,
      cvScoreDetails: latestScore,
      topMatches,
      insights,
      notifications,
      entitlements,
      verified: Boolean(candidate?.verifiedAt),
      visibilityBoostActive,
    };
  }
}
