import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export type AiToolKind = 'cv' | 'mock' | 'cover' | 'coach';

const TRIAL_FIELD: Record<AiToolKind, 'cvTrialUsedAt' | 'mockTrialUsedAt' | 'coverLetterTrialUsedAt' | 'coachTrialUsedAt'> =
  {
    cv: 'cvTrialUsedAt',
    mock: 'mockTrialUsedAt',
    cover: 'coverLetterTrialUsedAt',
    coach: 'coachTrialUsedAt',
  };

export async function consumeAiAccess(
  prisma: PrismaService,
  candidateId: string,
  kind: AiToolKind,
): Promise<{ via: 'all_access' | 'entitlement' | 'trial' }> {
  const now = new Date();
  const [candidate, allAccess, pack] = await Promise.all([
    prisma.candidate.findUnique({ where: { id: candidateId } }),
    prisma.entitlement.findUnique({
      where: { candidateId_sku: { candidateId, sku: 'ALL_ACCESS' } },
    }),
    prisma.entitlement.findUnique({
      where: {
        candidateId_sku: {
          candidateId,
          sku: kind === 'mock' ? 'MOCK_INTERVIEW_PACK' : 'CV_OPTIMIZATION',
        },
      },
    }),
  ]);
  if (!candidate) throw new BadRequestException('Candidate not found');

  const allAccessOk =
    (allAccess?.remaining ?? 0) > 0 &&
    (!allAccess?.expiresAt || allAccess.expiresAt > now);
  if (allAccessOk) return { via: 'all_access' };

  if (kind === 'mock' && (pack?.remaining ?? 0) > 0) {
    await prisma.entitlement.update({
      where: { id: pack!.id },
      data: { remaining: { decrement: 1 } },
    });
    return { via: 'entitlement' };
  }

  if (kind === 'cv' && (pack?.remaining ?? 0) > 0) {
    await prisma.entitlement.update({
      where: { id: pack!.id },
      data: { remaining: { decrement: 1 } },
    });
    return { via: 'entitlement' };
  }

  if (
    (kind === 'cover' || kind === 'coach') &&
    (pack?.remaining ?? 0) > 0
  ) {
    return { via: 'entitlement' };
  }

  const trialField = TRIAL_FIELD[kind];
  if (!candidate[trialField]) {
    await prisma.candidate.update({
      where: { id: candidateId },
      data: { [trialField]: now },
    });
    return { via: 'trial' };
  }

  const payHint =
    kind === 'mock'
      ? 'Purchase a mock interview pack (₦15,000 / 3 sessions) or All-Access.'
      : kind === 'coach'
        ? 'Purchase All-Access or CV optimization to continue coaching.'
        : 'Purchase CV optimization (₦5,000) or All-Access to continue.';
  throw new BadRequestException(
    `Free trial used. ${payHint}`,
  );
}

export function trialStatusFromCandidate(candidate: {
  cvTrialUsedAt: Date | null;
  mockTrialUsedAt: Date | null;
  coverLetterTrialUsedAt: Date | null;
  coachTrialUsedAt: Date | null;
}) {
  return {
    cv: !candidate.cvTrialUsedAt,
    mock: !candidate.mockTrialUsedAt,
    coverLetter: !candidate.coverLetterTrialUsedAt,
    coach: !candidate.coachTrialUsedAt,
  };
}
