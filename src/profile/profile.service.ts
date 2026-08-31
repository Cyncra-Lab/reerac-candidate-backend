import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service.js';
import { LlmClient } from '../ai/llm.client.js';
import { B2bClientService } from '../b2b/b2b-client.service.js';
import { scoreCvForAts } from './cv-ats-score.js';
import { extractCvTextFromBuffer } from './cv-text.extract.js';

const CV_UPLOAD_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

type UploadedCvFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmClient,
    private readonly b2b: B2bClientService,
  ) {}

  async get(candidateId: string) {
    const candidate = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
      include: {
        profile: true,
        cvAssets: { orderBy: { createdAt: 'desc' }, take: 5 },
        cvScores: { orderBy: { createdAt: 'desc' }, take: 1 },
        entitlements: true,
        jobPreference: true,
        skillAssessments: true,
      },
    });
    if (!candidate) throw new NotFoundException('Candidate not found');

    const now = new Date();
    const primaryCv = candidate.cvAssets.find((a) => a.isPrimary) ?? candidate.cvAssets[0];
    return {
      ...candidate,
      verified: Boolean(candidate.verifiedAt),
      visibilityBoostActive: Boolean(
        candidate.visibilityBoostUntil &&
          candidate.visibilityBoostUntil > now,
      ),
      trials: {
        cv: !candidate.cvTrialUsedAt,
        mock: !candidate.mockTrialUsedAt,
        coverLetter: !candidate.coverLetterTrialUsedAt,
        coach: !candidate.coachTrialUsedAt,
      },
      primaryCv: primaryCv
        ? { url: primaryCv.url, fileName: primaryCv.fileName }
        : null,
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
      openToWork?: 'ACTIVELY_LOOKING' | 'OPEN' | 'NOT_LOOKING';
      salaryExpectationMin?: number;
      salaryCurrency?: string;
      preferredWorkMode?: string;
      availabilityDate?: string;
      educationLevel?: string;
      schoolName?: string;
      graduationYear?: number;
      nyscStatus?: 'SERVING' | 'COMPLETED' | 'NOT_APPLICABLE';
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
        openToWork: dto.openToWork,
        salaryExpectationMin: dto.salaryExpectationMin,
        salaryCurrency: dto.salaryCurrency,
        preferredWorkMode: dto.preferredWorkMode,
        availabilityDate: dto.availabilityDate
          ? new Date(dto.availabilityDate)
          : undefined,
        educationLevel: dto.educationLevel,
        schoolName: dto.schoolName,
        graduationYear: dto.graduationYear,
        nyscStatus: dto.nyscStatus,
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

  async updatePreferences(
    candidateId: string,
    dto: {
      roleFamilies?: string[];
      locations?: string[];
      workModes?: string[];
      salaryFloor?: number;
      nyscOrEntry?: boolean;
    },
  ) {
    await this.prisma.candidateJobPreference.upsert({
      where: { candidateId },
      create: {
        candidateId,
        roleFamilies: dto.roleFamilies ?? [],
        locations: dto.locations ?? [],
        workModes: dto.workModes ?? [],
        salaryFloor: dto.salaryFloor,
        nyscOrEntry: dto.nyscOrEntry ?? false,
        quizCompletedAt: new Date(),
      },
      update: {
        roleFamilies: dto.roleFamilies,
        locations: dto.locations,
        workModes: dto.workModes,
        salaryFloor: dto.salaryFloor,
        nyscOrEntry: dto.nyscOrEntry,
        quizCompletedAt: new Date(),
      },
    });
    return this.get(candidateId);
  }

  async uploadCvFile(candidateId: string, file?: UploadedCvFile) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('CV file is required');
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('CV must be 5MB or smaller');
    }
    const mime = file.mimetype?.toLowerCase() ?? '';
    const name = file.originalname?.toLowerCase() ?? '';
    const allowed =
      CV_UPLOAD_MIME.has(mime) || /\.(pdf|docx?)$/.test(name);
    if (!allowed) {
      throw new BadRequestException(
        'CV must be a PDF or Word document (.pdf, .doc, .docx).',
      );
    }
    const stored = await this.b2b.uploadProfileCv(file);
    const extracted = await extractCvTextFromBuffer({
      buffer: file.buffer,
      fileName: file.originalname || 'cv.pdf',
      mimetype: file.mimetype,
    });
    return this.uploadCv(
      candidateId,
      {
        url: stored.key,
        fileName: file.originalname || 'cv.pdf',
      },
      extracted,
    );
  }

  async uploadCv(
    candidateId: string,
    dto: { url: string; fileName: string },
    cvText?: string | null,
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

    const extracted = cvText ?? (await this.tryFetchCvText(dto.url));
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
    const fallback = scoreCvForAts({
      fileName: input.fileName,
      cvText: input.cvText,
      roleInterest: input.roleInterest,
      skills: input.skills,
    });

    const ai = await this.llm.chatJson<{
      overallScore?: number;
      strengths?: string[];
      improvements?: string[];
      summary?: string;
    }>([
      {
        role: 'system',
        content:
          'You are an ATS CV scorer (Jobscan/Teal style). Score 0-100 for parseability, completeness, quantified impact, and keyword strength. A professional, well-structured CV should typically score 75-90. Only go below 70 if the file is thin, unreadable, or missing core sections. Return JSON: overallScore, strengths (3-5), improvements (3-5), summary.',
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
          parsedTextChars: input.cvText?.length ?? 0,
        }),
      },
    ]);

    if (!ai || typeof ai.overallScore !== 'number') return fallback;

    const aiScore = Math.max(1, Math.min(96, Math.round(ai.overallScore)));
    const overallScore = input.cvText
      ? Math.round(fallback.overallScore * 0.55 + aiScore * 0.45)
      : aiScore;

    return {
      overallScore: Math.max(fallback.overallScore - 4, Math.min(96, overallScore)),
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
}
