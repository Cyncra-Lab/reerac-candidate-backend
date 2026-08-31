import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { LlmClient } from '../ai/llm.client.js';
import { JobsService } from '../jobs/jobs.service.js';
import { consumeAiAccess, trialStatusFromCandidate } from './ai-access.js';
import { HUMAN_CAREER_VOICE, humanizeAiText } from '../lib/humanize-ai-text.js';

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
          `You are an expert African-market CV coach. Optimize the candidate CV for ATS and recruiter clarity. Return JSON keys: overallScore (0-100), strengths (string[]), improvements (string[]), summary (string), optimizedCv (markdown rewrite). ${HUMAN_CAREER_VOICE}`,
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
        strengths = ai.strengths.slice(0, 6).map((s) => humanizeAiText(String(s)));
      }
      if (Array.isArray(ai.improvements) && ai.improvements.length) {
        improvements = ai.improvements.slice(0, 6).map((s) => humanizeAiText(String(s)));
      }
      if (typeof ai.summary === 'string' && ai.summary.trim()) {
        summary = humanizeAiText(ai.summary);
      }
      if (typeof ai.optimizedCv === 'string' && ai.optimizedCv.trim()) {
        optimizedContent = humanizeAiText(ai.optimizedCv);
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

    optimizedContent = humanizeAiText(optimizedContent);
    summary = humanizeAiText(summary);

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
            `Write a concise, professional cover letter for African hiring markets. 180-280 words. No markdown. Address the hiring team. Quantify where possible. Do not invent employers or metrics. ${HUMAN_CAREER_VOICE}`,
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

    const content = humanizeAiText(ai?.trim() || fallback);
    const saved = await this.prisma.coverLetter.create({
      data: {
        candidateId,
        jobListingId: listing.id,
        content,
      },
    });
    return { id: saved.id, jobId: listing.b2bJobId, content };
  }

  async getCoachThread(candidateId: string) {
    const thread = await this.prisma.coachThread.findFirst({
      where: { candidateId },
      orderBy: { updatedAt: 'desc' },
    });
    return {
      threadId: thread?.id ?? null,
      messages: this.normalizeCoachMessages(thread?.messages),
    };
  }

  private normalizeCoachMessages(raw: unknown): Array<{
    role: 'user' | 'assistant';
    content: string;
  }> {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((entry) => {
        const row = entry as { role?: unknown; content?: unknown };
        const content = humanizeAiText(String(row.content ?? ''));
        if (!content) return null;
        return {
          role: row.role === 'user' ? ('user' as const) : ('assistant' as const),
          content,
        };
      })
      .filter((row): row is { role: 'user' | 'assistant'; content: string } =>
        Boolean(row),
      );
  }

  async coach(candidateId: string, message: string) {
    if (!message.trim()) throw new BadRequestException('message is required');

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
    const history = this.normalizeCoachMessages(thread?.messages);

    // First message in a thread uses the trial / paid access; follow-ups continue the chat.
    if (history.length === 0) {
      await consumeAiAccess(this.prisma, candidateId, 'coach');
    }

    const firstName = candidate.firstName?.trim() || 'there';
    const fallback = this.fallbackCoachReply(message, firstName);

    const profileNotes = [
      `Name: ${candidate.firstName} ${candidate.lastName}`,
      `Target role: ${candidate.roleInterest ?? 'not set'}`,
      `Location: ${candidate.location ?? 'not set'}`,
      `Skills: ${(candidate.profile?.skills ?? []).join(', ') || 'not set'}`,
      `CV score: ${candidate.cvScores[0]?.overallScore ?? 'unknown'}`,
      `Open to work: ${candidate.openToWork}`,
    ].join('\n');

    const chatMessages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string;
    }> = [
      {
        role: 'system',
        content: `You are Reerac, a warm career coach in a live chat with ${firstName}. Answer the latest message directly. If they greet you (hi, hello, hey, hi Reerac), greet them back by name and ask what they want to work on. Do not dump generic CV or interview advice unless they asked for it. Be brief, specific, and human. Ask one follow-up when it helps. Do not invent job offers.

Candidate background, use only when relevant:
${profileNotes}

${HUMAN_CAREER_VOICE}`,
      },
      ...history.slice(-10).map((row) => ({
        role: row.role,
        content: row.content,
      })),
      { role: 'user', content: message.trim() },
    ];

    const reply = humanizeAiText(
      (await this.llm.chatText(chatMessages, {
        temperature: 0.55,
        maxTokens: 500,
      })) || fallback,
    );

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

    return {
      reply,
      threadId: thread.id,
      messages: this.normalizeCoachMessages(messages),
    };
  }

  private fallbackCoachReply(message: string, firstName: string): string {
    const text = message.trim();
    const first = firstName || 'there';
    if (
      /^(hi|hello|hey|yo|hiya|howdy|good\s+(morning|afternoon|evening))\b/i.test(
        text,
      ) ||
      /\b(hi|hello|hey)\s+reerac\b/i.test(text)
    ) {
      return `Hi ${first}. I am your Reerac career coach. What would you like to work on today: your CV, interviews, applications, or salary?`;
    }
    return `I heard you, ${first}. I can help with CVs, interviews, applications, and salary. Tell me a bit more about what you need and I will get specific.`;
  }
}
