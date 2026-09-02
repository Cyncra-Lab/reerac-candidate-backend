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
import { scoreCvForAts, type CvAtsScore } from './cv-ats-score.js';
import {
  buildCanonicalRubric,
  mergeRubric,
  normalizeRoleKey,
  seniorityBand,
  type AtsRubric,
} from './cv-ats-rubric.js';
import { extractCvTextFromBuffer } from './cv-text.extract.js';

const CV_UPLOAD_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const memoryScoreCache = new Map<string, CvAtsScore>();

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
      yearsExperience: candidate?.profile?.yearsExperience,
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
    yearsExperience?: number | null;
  }): Promise<CvAtsScore> {
    const { rubric, rubricId } = await this.getOrCreateRubric(input);
    const local = scoreCvForAts({
      fileName: input.fileName,
      cvText: input.cvText,
      roleInterest: input.roleInterest,
      skills: input.skills,
      experienceLevel: input.experienceLevel,
      yearsExperience: input.yearsExperience,
      rubric,
    });

    const cached = await this.readScoreCache(rubricId, local.textHash);
    if (cached) return cached;

    let scored = local;
    if (local.documentType === 'cv') {
      const ai = await this.llm.chatJson<{
        strengths?: string[];
        improvements?: string[];
        summary?: string;
      }>(
        [
          {
            role: 'system',
            content:
              'You are a strict role-family ATS. Do not change the overall score. Explain strengths and gaps against the rubric. Non-CVs and other fields should be called out plainly. Return JSON: strengths (3-5), improvements (3-5), summary.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              fileName: input.fileName,
              roleInterest: input.roleInterest ?? null,
              overallScore: local.overallScore,
              roleFamilyMatch: local.roleFamilyMatch,
              rubric,
              cvExcerpt: input.cvText?.slice(0, 8000) ?? null,
            }),
          },
        ],
        { temperature: 0, maxTokens: 700 },
      );

      if (ai) {
        scored = {
          ...local,
          strengths:
            Array.isArray(ai.strengths) && ai.strengths.length
              ? ai.strengths.slice(0, 6).map(String)
              : local.strengths,
          improvements:
            Array.isArray(ai.improvements) && ai.improvements.length
              ? ai.improvements.slice(0, 6).map(String)
              : local.improvements,
          summary:
            typeof ai.summary === 'string' && ai.summary.trim()
              ? ai.summary.trim()
              : local.summary,
        };
      }
    }

    await this.writeScoreCache(rubricId, scored);
    return scored;
  }

  private async getOrCreateRubric(input: {
    roleInterest?: string | null;
    experienceLevel?: string | null;
    yearsExperience?: number | null;
  }): Promise<{ rubric: AtsRubric; rubricId: string | null }> {
    const canonical = buildCanonicalRubric(input);
    const roleKey = normalizeRoleKey(input.roleInterest);
    const band = seniorityBand(input.experienceLevel, input.yearsExperience);

    try {
      const existing = await this.prisma.cvAtsRubric.findUnique({
        where: {
          roleKey_seniorityBand: { roleKey, seniorityBand: band },
        },
      });
      if (existing) {
        return {
          rubricId: existing.id,
          rubric: mergeRubric(canonical, existing.rubric as Partial<AtsRubric>),
        };
      }

      let rubric = canonical;
      const ai = await this.llm.chatJson<Partial<AtsRubric>>(
        [
          {
            role: 'system',
            content:
              'Build a standard ATS rubric for this job bracket in African hiring. This is a role family bar, not one job posting. Return JSON: mustHaveKeywords (string[]), skills (string[]), relatedKeywords (string[]), disqualifyingFields (string[]), yearsMin (number), yearsMax (number).',
          },
          {
            role: 'user',
            content: JSON.stringify({
              roleInterest: input.roleInterest ?? 'general professional',
              seniorityBand: band,
              yearsExperience: input.yearsExperience ?? null,
            }),
          },
        ],
        { temperature: 0, maxTokens: 800 },
      );
      rubric = mergeRubric(canonical, ai);

      const created = await this.prisma.cvAtsRubric.create({
        data: {
          roleKey,
          seniorityBand: band,
          rubric,
        },
      });
      return { rubricId: created.id, rubric };
    } catch (err) {
      this.logger.debug(
        `ATS rubric store skipped: ${(err as Error).message}`,
      );
      return { rubricId: null, rubric: canonical };
    }
  }

  private async readScoreCache(
    rubricId: string | null,
    textHash: string,
  ): Promise<CvAtsScore | null> {
    if (!rubricId) return memoryScoreCache.get(`${rubricId}:${textHash}`) ?? null;
    const mem = memoryScoreCache.get(`${rubricId}:${textHash}`);
    if (mem) return mem;
    try {
      const row = await this.prisma.cvAtsScoreCache.findUnique({
        where: { rubricId_textHash: { rubricId, textHash } },
      });
      if (!row) return null;
      const rubric = await this.prisma.cvAtsRubric.findUnique({
        where: { id: rubricId },
      });
      return {
        overallScore: row.overallScore,
        strengths: row.strengths,
        improvements: row.improvements,
        summary: row.summary ?? '',
        documentType: 'cv',
        roleFamilyMatch: 'target',
        textHash,
        roleKey: rubric?.roleKey ?? 'generic',
        seniorityBand: (rubric?.seniorityBand as AtsRubric['seniorityBand']) ?? 'mid',
      };
    } catch (err) {
      this.logger.debug(`ATS score cache read skipped: ${(err as Error).message}`);
      return null;
    }
  }

  private async writeScoreCache(rubricId: string | null, scored: CvAtsScore) {
    const key = `${rubricId}:${scored.textHash}`;
    memoryScoreCache.set(key, scored);
    if (!rubricId) return;
    try {
      await this.prisma.cvAtsScoreCache.upsert({
        where: {
          rubricId_textHash: { rubricId, textHash: scored.textHash },
        },
        create: {
          rubricId,
          textHash: scored.textHash,
          overallScore: scored.overallScore,
          strengths: scored.strengths,
          improvements: scored.improvements,
          summary: scored.summary,
        },
        update: {
          overallScore: scored.overallScore,
          strengths: scored.strengths,
          improvements: scored.improvements,
          summary: scored.summary,
        },
      });
    } catch (err) {
      this.logger.debug(
        `ATS score cache write skipped: ${(err as Error).message}`,
      );
    }
  }
}
