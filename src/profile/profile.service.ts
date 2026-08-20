import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service.js';
import { LlmClient } from '../ai/llm.client.js';

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmClient,
  ) {}

  async get(candidateId: string) {
    const candidate = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
      include: {
        profile: true,
        cvAssets: { orderBy: { createdAt: 'desc' }, take: 5 },
        cvScores: { orderBy: { createdAt: 'desc' }, take: 1 },
        entitlements: true,
      },
    });
    if (!candidate) throw new NotFoundException('Candidate not found');

    const now = new Date();
    return {
      ...candidate,
      verified: Boolean(candidate.verifiedAt),
      visibilityBoostActive: Boolean(
        candidate.visibilityBoostUntil &&
          candidate.visibilityBoostUntil > now,
      ),
    };
  }

  async update(
    candidateId: string,
    dto: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      linkedInUrl?: string;
      location?: string;
      roleInterest?: string;
      experienceLevel?: string;
      summary?: string;
      skills?: string[];
      yearsExperience?: number;
    },
  ) {
    await this.prisma.candidate.update({
      where: { id: candidateId },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        linkedInUrl: dto.linkedInUrl,
        location: dto.location,
        roleInterest: dto.roleInterest,
        experienceLevel: dto.experienceLevel,
      },
    });

    await this.prisma.candidateProfile.upsert({
      where: { candidateId },
      create: {
        candidateId,
        summary: dto.summary,
        skills: dto.skills ?? [],
        yearsExperience: dto.yearsExperience,
      },
      update: {
        summary: dto.summary,
        skills: dto.skills,
        yearsExperience: dto.yearsExperience,
      },
    });

    return this.get(candidateId);
  }

  async uploadCv(
    candidateId: string,
    dto: { url: string; fileName: string },
  ) {
    await this.prisma.cvAsset.updateMany({
      where: { candidateId, isPrimary: true },
      data: { isPrimary: false },
    });
    const asset = await this.prisma.cvAsset.create({
      data: {
        candidateId,
        url: dto.url,
        fileName: dto.fileName,
        isPrimary: true,
      },
    });

    const candidate = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
      include: { profile: true },
    });

    const extracted = await this.tryFetchCvText(dto.url);
    const scored = await this.scoreCv({
      fileName: dto.fileName,
      cvText: extracted,
      roleInterest: candidate?.roleInterest,
      skills: candidate?.profile?.skills ?? [],
      summary: candidate?.profile?.summary,
      experienceLevel: candidate?.experienceLevel,
    });

    await this.prisma.cvScore.create({
      data: {
        candidateId,
        cvAssetId: asset.id,
        overallScore: scored.overallScore,
        strengths: scored.strengths,
        improvements: scored.improvements,
        summary: scored.summary,
        source: 'UPLOAD',
      },
    });

    return this.get(candidateId);
  }

  private async tryFetchCvText(url: string): Promise<string | null> {
    if (!/^https?:\/\//i.test(url)) return null;
    try {
      const res = await axios.get(url, {
        timeout: 15_000,
        responseType: 'text',
        maxContentLength: 500_000,
        validateStatus: (s) => s >= 200 && s < 400,
      });
      const contentType = String(res.headers['content-type'] ?? '');
      if (
        contentType.includes('text') ||
        contentType.includes('json') ||
        typeof res.data === 'string'
      ) {
        const text = String(res.data).slice(0, 12_000);
        if (text.length > 80) return text;
      }
    } catch (err) {
      this.logger.debug(`CV fetch skipped: ${(err as Error).message}`);
    }
    return null;
  }

  private async scoreCv(input: {
    fileName: string;
    cvText: string | null;
    roleInterest?: string | null;
    skills: string[];
    summary?: string | null;
    experienceLevel?: string | null;
  }) {
    const fallback = this.heuristicScore(input);

    const ai = await this.llm.chatJson<{
      overallScore?: number;
      strengths?: string[];
      improvements?: string[];
      summary?: string;
    }>([
      {
        role: 'system',
        content:
          'You score CVs for African job markets (0-100). Judge structure, formatting signals, keyword strength, and completeness. Return JSON: overallScore, strengths (3-5), improvements (3-5), summary.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          fileName: input.fileName,
          roleInterest: input.roleInterest,
          experienceLevel: input.experienceLevel,
          skills: input.skills,
          profileSummary: input.summary,
          cvExcerpt: input.cvText?.slice(0, 8000) ?? null,
        }),
      },
    ]);

    if (!ai || typeof ai.overallScore !== 'number') return fallback;

    return {
      overallScore: Math.max(1, Math.min(98, Math.round(ai.overallScore))),
      strengths:
        Array.isArray(ai.strengths) && ai.strengths.length
          ? ai.strengths.slice(0, 6).map(String)
          : fallback.strengths,
      improvements:
        Array.isArray(ai.improvements) && ai.improvements.length
          ? ai.improvements.slice(0, 6).map(String)
          : fallback.improvements,
      summary:
        typeof ai.summary === 'string' && ai.summary.trim()
          ? ai.summary.trim()
          : fallback.summary,
    };
  }

  private heuristicScore(input: {
    fileName: string;
    cvText: string | null;
    roleInterest?: string | null;
    skills: string[];
    summary?: string | null;
    experienceLevel?: string | null;
  }) {
    let score = 48;
    if (input.roleInterest) score += 8;
    if (input.experienceLevel) score += 6;
    if (input.skills.length >= 3) score += 10;
    else if (input.skills.length > 0) score += 5;
    if (input.summary && input.summary.length > 40) score += 8;
    if (input.cvText && input.cvText.length > 400) score += 12;
    if (/\.pdf$/i.test(input.fileName)) score += 4;
    score = Math.max(35, Math.min(88, score));

    return {
      overallScore: score,
      strengths: [
        input.skills.length
          ? 'Skills listed on profile'
          : 'CV file uploaded',
        input.roleInterest
          ? 'Clear role interest'
          : 'Contact profile available',
      ],
      improvements: [
        'Quantify impact with metrics',
        'Align keywords to target roles',
        'Tighten formatting and section structure',
      ],
      summary:
        'Baseline CV quality score from profile completeness and upload signals.',
    };
  }
}
