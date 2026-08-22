import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { LlmClient } from '../ai/llm.client.js';
import { JobsService } from '../jobs/jobs.service.js';
import { consumeAiAccess, trialStatusFromCandidate } from './ai-access.js';

@Injectable()
export class ToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmClient,
    private readonly jobs: JobsService,
  ) {}

  async status(candidateId: string) {
    const candidate = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
      include: { entitlements: true },
    });
    if (!candidate) throw new NotFoundException('Candidate not found');
    return {
      trials: trialStatusFromCandidate(candidate),
      entitlements: candidate.entitlements,
    };
  }

  async optimizeCv(candidateId: string) {
    await consumeAiAccess(this.prisma, candidateId, 'cv');
    return this.runCvOptimization(candidateId);
  }

  async runCvOptimization(candidateId: string) {
    const candidate = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
      include: {
        profile: true,
        cvScores: { orderBy: { createdAt: 'desc' }, take: 1 },
        cvAssets: { where: { isPrimary: true }, take: 1 },
      },
    });
    if (!candidate) throw new NotFoundException('Candidate not found');

    const latest = candidate.cvScores[0];
    const context = [
      `Name: ${candidate.firstName} ${candidate.lastName}`,
      `Role interest: ${candidate.roleInterest ?? 'general'}`,
      `Location: ${candidate.location ?? 'n/a'}`,
      `Skills: ${(candidate.profile?.skills ?? []).join(', ') || 'n/a'}`,
      `Summary: ${candidate.profile?.summary ?? latest?.summary ?? 'n/a'}`,
      `Current score: ${latest?.overallScore ?? 'unknown'}`,
    ].join('\n');

    let optimizedContent: string | null = null;
    let overallScore = Math.min(95, (latest?.overallScore ?? 60) + 12);
    let strengths = [
      ...(latest?.strengths ?? []),
      'Optimized keyword alignment',
    ];
    let improvements = ['Keep quantifying outcomes in new roles'];
    let summary = 'CV optimization applied.';

    const ai = await this.llm.chatJson<{
      overallScore?: number;
      strengths?: string[];
      improvements?: string[];
      summary?: string;
      optimizedCv?: string;
    }>([
      {
        role: 'system',
        content:
          'You are an expert African-market CV coach. Optimize the candidate CV for ATS and recruiter clarity. Return JSON keys: overallScore (0-100), strengths (string[]), improvements (string[]), summary (string), optimizedCv (markdown rewrite).',
      },
      {
        role: 'user',
        content: `Optimize this candidate profile into a stronger CV:\n${context}`,
      },
    ]);

    if (ai) {
      if (typeof ai.overallScore === 'number') {
        overallScore = Math.max(1, Math.min(98, Math.round(ai.overallScore)));
      }
      if (Array.isArray(ai.strengths) && ai.strengths.length) {
        strengths = ai.strengths.slice(0, 6).map(String);
      }
      if (Array.isArray(ai.improvements) && ai.improvements.length) {
        improvements = ai.improvements.slice(0, 6).map(String);
      }
      if (typeof ai.summary === 'string' && ai.summary.trim()) {
        summary = ai.summary.trim();
      }
      if (typeof ai.optimizedCv === 'string' && ai.optimizedCv.trim()) {
        optimizedContent = ai.optimizedCv.trim();
      }
    }

    if (!optimizedContent) {
      optimizedContent = [
        `# ${candidate.firstName} ${candidate.lastName}`,
        candidate.roleInterest ? `Target role: ${candidate.roleInterest}` : '',
        candidate.location ? `Location: ${candidate.location}` : '',
        '',
        '## Summary',
        candidate.profile?.summary || summary,
        '',
        '## Skills',
        (candidate.profile?.skills ?? []).join(', ') || 'Add core skills',
      ]
        .filter((line) => line !== '')
        .join('\n');
    }

    return this.prisma.cvScore.create({
      data: {
        candidateId,
        cvAssetId: latest?.cvAssetId ?? candidate.cvAssets[0]?.id,
        overallScore,
        strengths,
        improvements,
        summary,
        optimizedContent,
        source: 'OPTIMIZATION',
      },
    });
  }

  async coverLetter(candidateId: string, jobId: string) {
    await consumeAiAccess(this.prisma, candidateId, 'cover');
    const [candidate, listing] = await Promise.all([
      this.prisma.candidate.findUnique({
        where: { id: candidateId },
        include: { profile: true },
      }),
      this.jobs.getById(jobId),
    ]);
    if (!candidate) throw new NotFoundException('Candidate not found');

    const fallback = `Dear Hiring Team,\n\nI am applying for ${listing.title} at ${listing.companyName}. My background in ${candidate.roleInterest ?? 'this field'} and skills in ${(candidate.profile?.skills ?? []).slice(0, 5).join(', ') || 'the role requirements'} make me a strong fit. I would welcome the chance to contribute.\n\nKind regards,\n${candidate.firstName} ${candidate.lastName}`;

    const ai = await this.llm.chatText(
      [
        {
          role: 'system',
          content:
            'Write a concise, professional cover letter for African hiring markets. 180-280 words. No markdown. Address the hiring team. Quantify where possible. Do not invent employers or metrics.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            name: `${candidate.firstName} ${candidate.lastName}`,
            roleInterest: candidate.roleInterest,
            location: candidate.location,
            skills: candidate.profile?.skills ?? [],
            summary: candidate.profile?.summary,
            job: {
              title: listing.title,
              company: listing.companyName,
              location: listing.location,
              description: listing.description.slice(0, 2500),
              requirements: listing.requirements.slice(0, 12),
            },
          }),
        },
      ],
      { temperature: 0.4, maxTokens: 700 },
    );

    const content = ai?.trim() || fallback;
    const saved = await this.prisma.coverLetter.create({
      data: {
        candidateId,
        jobListingId: listing.id,
        content,
      },
    });
    return { id: saved.id, jobId: listing.b2bJobId, content };
  }

  async coach(candidateId: string, message: string) {
    if (!message.trim()) throw new BadRequestException('message is required');
    await consumeAiAccess(this.prisma, candidateId, 'coach');

    const candidate = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
      include: {
        profile: true,
        cvScores: { orderBy: { createdAt: 'desc' }, take: 1 },
        jobPreference: true,
      },
    });
    if (!candidate) throw new NotFoundException('Candidate not found');

    let thread = await this.prisma.coachThread.findFirst({
      where: { candidateId },
      orderBy: { updatedAt: 'desc' },
    });
    const history = Array.isArray(thread?.messages)
      ? (thread!.messages as Array<{ role: string; content: string }>)
      : [];

    const fallback =
      'Focus your applications on roles that match your CV keywords, quantify two recent achievements, and practise a 90-second pitch before interviews.';

    const reply =
      (await this.llm.chatText(
        [
          {
            role: 'system',
            content:
              'You are Reerac Career Coach for African job seekers. Be practical, short, and specific. Cover CV, applications, interviews, and salary. Do not invent job offers.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              profile: {
                roleInterest: candidate.roleInterest,
                location: candidate.location,
                skills: candidate.profile?.skills,
                cvScore: candidate.cvScores[0]?.overallScore,
                openToWork: candidate.openToWork,
              },
              history: history.slice(-8),
              message: message.trim(),
            }),
          },
        ],
        { temperature: 0.4, maxTokens: 500 },
      )) || fallback;

    const messages = [
      ...history,
      { role: 'user', content: message.trim() },
      { role: 'assistant', content: reply },
    ].slice(-20);

    if (thread) {
      thread = await this.prisma.coachThread.update({
        where: { id: thread.id },
        data: { messages },
      });
    } else {
      thread = await this.prisma.coachThread.create({
        data: { candidateId, messages },
      });
    }

    return { reply, threadId: thread.id, messages };
  }
}
