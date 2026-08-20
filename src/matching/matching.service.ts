import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { LlmClient } from '../ai/llm.client.js';

@Injectable()
export class MatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmClient,
  ) {}

  async refreshForCandidate(candidateId: string) {
    const candidate = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
      include: {
        profile: true,
        cvScores: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!candidate) return { updated: 0 };

    const jobs = await this.prisma.jobListing.findMany({
      where: { status: 'ACTIVE' },
      take: 50,
      orderBy: { syncedAt: 'desc' },
    });

    const interest = (candidate.roleInterest ?? '').toLowerCase();
    const skills = new Set(
      (candidate.profile?.skills ?? []).map((s) => s.toLowerCase()),
    );
    const boostActive =
      candidate.visibilityBoostUntil != null &&
      candidate.visibilityBoostUntil > new Date();

    type Scored = {
      jobId: string;
      title: string;
      score: number;
      rationale: string;
      requirements: string[];
      location: string | null;
    };
    const scored: Scored[] = [];

    for (const job of jobs) {
      let score = 40;
      const title = job.title.toLowerCase();
      const interestTokens = interest
        .split(/[\s,/|-]+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 2);
      if (interestTokens.some((t) => title.includes(t))) score += 25;

      for (const req of job.requirements) {
        if (skills.has(req.toLowerCase())) score += 5;
      }
      for (const skill of skills) {
        if (skill.length > 2 && title.includes(skill)) score += 3;
      }

      if (candidate.location && job.location) {
        if (
          job.location.toLowerCase().includes(candidate.location.toLowerCase()) ||
          candidate.location.toLowerCase().includes(job.location.toLowerCase())
        ) {
          score += 10;
        }
      }
      if (candidate.cvScores[0]) {
        score += Math.round(candidate.cvScores[0].overallScore / 20);
      }
      if (candidate.verifiedAt) score += 3;
      if (boostActive) score += 15;

      score = Math.max(20, Math.min(98, score));
      let rationale = `Matched ${job.title} using profile, skills, and CV signals.`;
      if (boostActive) rationale += ' Visibility Boost applied.';

      scored.push({
        jobId: job.id,
        title: job.title,
        score,
        rationale,
        requirements: job.requirements.slice(0, 12),
        location: job.location,
      });
    }

    // LLM-refine only the strongest heuristic matches (cost control).
    if (this.llm.isConfigured) {
      const top = [...scored].sort((a, b) => b.score - a.score).slice(0, 8);
      for (const row of top) {
        if (row.score < 65) continue;
        const ai = await this.llm.chatJson<{
          matchPercent?: number;
          rationale?: string;
        }>(
          [
            {
              role: 'system',
              content:
                'Score candidate-job fit 0-100. Return JSON { matchPercent, rationale } (1 short sentence).',
            },
            {
              role: 'user',
              content: JSON.stringify({
                roleInterest: candidate.roleInterest,
                skills: candidate.profile?.skills ?? [],
                location: candidate.location,
                cvScore: candidate.cvScores[0]?.overallScore,
                job: {
                  title: row.title,
                  location: row.location,
                  requirements: row.requirements,
                },
                heuristicScore: row.score,
              }),
            },
          ],
          { maxTokens: 200, temperature: 0.2 },
        );
        if (ai?.matchPercent != null) {
          row.score = Math.max(
            20,
            Math.min(
              98,
              Math.round(row.score * 0.55 + Number(ai.matchPercent) * 0.45),
            ),
          );
        }
        if (typeof ai?.rationale === 'string' && ai.rationale.trim()) {
          row.rationale = ai.rationale.trim();
          if (boostActive) row.rationale += ' Visibility Boost applied.';
        }
      }
    }

    let updated = 0;
    for (const row of scored) {
      const rankLabel =
        row.score >= 90
          ? 'Top 5% applicant'
          : row.score >= 80
            ? 'Top 15% applicant'
            : row.score >= 70
              ? 'Strong match'
              : 'Potential match';

      await this.prisma.matchScore.upsert({
        where: {
          candidateId_jobListingId: {
            candidateId,
            jobListingId: row.jobId,
          },
        },
        create: {
          candidateId,
          jobListingId: row.jobId,
          matchPercent: row.score,
          relativeRankLabel: rankLabel,
          rationale: row.rationale,
        },
        update: {
          matchPercent: row.score,
          relativeRankLabel: rankLabel,
          rationale: row.rationale,
        },
      });
      updated++;
    }

    return { updated };
  }

  topMatches(candidateId: string, limit = 5) {
    return this.prisma.matchScore.findMany({
      where: { candidateId },
      include: { jobListing: true },
      orderBy: { matchPercent: 'desc' },
      take: limit,
    });
  }
}
