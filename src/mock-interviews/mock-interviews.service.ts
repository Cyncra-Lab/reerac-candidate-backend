import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { LlmClient } from '../ai/llm.client.js';
import { consumeAiAccess } from '../tools/ai-access.js';
import { HUMAN_CAREER_VOICE, humanizeAiText } from '../lib/humanize-ai-text.js';

type Turn = {
  order: number;
  question: string;
  answer: string | null;
};

@Injectable()
export class MockInterviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmClient,
  ) {}

  list(candidateId: string) {
    return this.prisma.mockInterviewSession.findMany({
      where: { candidateId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(candidateId: string, sessionId: string) {
    const session = await this.prisma.mockInterviewSession.findFirst({
      where: { id: sessionId, candidateId },
    });
    if (!session) throw new NotFoundException('Session not found');
    return this.present(session);
  }

  async start(candidateId: string, roleTitle: string) {
    const role = roleTitle.trim();
    if (role.length < 2) {
      throw new BadRequestException(
        'Enter the role you want to interview for before starting.',
      );
    }

    await consumeAiAccess(this.prisma, candidateId, 'mock');

    const candidate = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
      include: {
        profile: true,
        cvScores: { orderBy: { createdAt: 'desc' }, take: 1 },
        cvAssets: { where: { isPrimary: true }, take: 1 },
      },
    });
    if (!candidate) throw new NotFoundException('Candidate not found');

    const questions = await this.buildQuestions(role, candidate);

    const session = await this.prisma.mockInterviewSession.create({
      data: {
        candidateId,
        roleTitle: role,
        status: 'IN_PROGRESS',
        startedAt: new Date(),
        turns: questions.map((q, i) => ({
          order: i + 1,
          question: q,
          answer: null,
        })),
      },
    });
    return this.present(session);
  }

  private resumeBrief(candidate: {
    firstName: string;
    lastName: string;
    roleInterest: string | null;
    location: string | null;
    experienceLevel: string | null;
    profile: {
      summary: string | null;
      skills: string[];
      yearsExperience: number | null;
    } | null;
    cvScores: Array<{
      summary: string | null;
      strengths: string[];
      optimizedContent: string | null;
    }>;
    cvAssets: Array<{ fileName: string }>;
  }): string {
    const latest = candidate.cvScores[0];
    return [
      `Name: ${candidate.firstName} ${candidate.lastName}`,
      `Profile target role: ${candidate.roleInterest ?? 'n/a'}`,
      `Location: ${candidate.location ?? 'n/a'}`,
      `Experience level: ${candidate.experienceLevel ?? 'n/a'}`,
      `Years: ${candidate.profile?.yearsExperience ?? 'n/a'}`,
      `Skills: ${(candidate.profile?.skills ?? []).join(', ') || 'n/a'}`,
      `CV file: ${candidate.cvAssets[0]?.fileName ?? 'none uploaded'}`,
      `Profile summary: ${candidate.profile?.summary ?? 'n/a'}`,
      `CV score summary: ${latest?.summary ?? 'n/a'}`,
      latest?.strengths?.length
        ? `CV strengths: ${latest.strengths.join('; ')}`
        : '',
      latest?.optimizedContent
        ? `Resume text:\n${latest.optimizedContent.slice(0, 4500)}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private async buildQuestions(
    roleTitle: string,
    candidate: {
      firstName: string;
      lastName: string;
      roleInterest: string | null;
      location: string | null;
      experienceLevel: string | null;
      profile: {
        summary: string | null;
        skills: string[];
        yearsExperience: number | null;
      } | null;
      cvScores: Array<{
        summary: string | null;
        strengths: string[];
        optimizedContent: string | null;
      }>;
      cvAssets: Array<{ fileName: string }>;
    },
  ): Promise<string[]> {
    const fallback = [
      `Tell me about yourself and why you want to work as a ${roleTitle}.`,
      `Walk me through a recent project from your resume that is relevant to a ${roleTitle} role. What was your part, and what changed because of it?`,
      `What in your background makes you ready for this ${roleTitle} role now?`,
      'Describe a difficult stakeholder or team situation and how you handled it.',
      `If you joined as a ${roleTitle} tomorrow, what would you focus on in the first 90 days?`,
      'What do you want to get better at, and how are you working on it?',
    ];

    const resume = this.resumeBrief(candidate);
    const ai = await this.llm.chatJson<{ questions?: string[] }>(
      [
        {
          role: 'system',
          content:
            'You are a hiring manager running a practice interview. Return JSON { "questions": string[6] }. Ask one question at a time in the array order: intro, resume-specific, role competency, behavioral, situational, close. Ground resume-specific questions in the CV without inventing employers, titles, or metrics. If the resume is thin, stay role-generic. Each question should sound spoken, short, and human. ' +
            HUMAN_CAREER_VOICE,
        },
        {
          role: 'user',
          content: `Interview the candidate for this role: ${roleTitle}\n\nResume and profile:\n${resume}`,
        },
      ],
      { temperature: 0.45, maxTokens: 900 },
    );

    if (Array.isArray(ai?.questions) && ai.questions.length >= 6) {
      return ai.questions.slice(0, 6).map((q) => humanizeAiText(String(q)));
    }
    return fallback.map((q) => humanizeAiText(q));
  }

  async submitTurn(
    candidateId: string,
    sessionId: string,
    dto: { order: number; answer: string },
  ) {
    const session = await this.prisma.mockInterviewSession.findFirst({
      where: { id: sessionId, candidateId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Session is not in progress');
    }

    const answer = dto.answer.trim();
    if (!answer) throw new BadRequestException('Answer is required');

    const turns = this.normalizeTurns(session.turns);
    if (!turns.some((t) => t.order === dto.order)) {
      throw new BadRequestException('Unknown question');
    }

    const next = turns.map((t) =>
      t.order === dto.order ? { ...t, answer } : t,
    );
    const allAnswered = next.every((t) => t.answer && t.answer.trim());

    if (!allAnswered) {
      const updated = await this.prisma.mockInterviewSession.update({
        where: { id: sessionId },
        data: { turns: next },
      });
      return this.present(updated);
    }

    const evaluation = await this.evaluateSession(session.roleTitle, next);
    const updated = await this.prisma.mockInterviewSession.update({
      where: { id: sessionId },
      data: {
        turns: next,
        status: 'COMPLETED',
        completedAt: new Date(),
        score: evaluation.score,
        feedback: evaluation.feedback,
      },
    });
    return this.present(updated);
  }

  private normalizeTurns(raw: unknown): Turn[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((entry, i) => {
      const row = entry as Partial<Turn>;
      return {
        order: Number(row.order) || i + 1,
        question: humanizeAiText(String(row.question ?? '')),
        answer:
          typeof row.answer === 'string' && row.answer.trim()
            ? row.answer
            : null,
      };
    });
  }

  private present(session: {
    id: string;
    candidateId: string;
    roleTitle: string;
    status: string;
    score: number | null;
    feedback: string | null;
    turns: unknown;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
  }) {
    const turns = this.normalizeTurns(session.turns);
    const pending = turns.find((t) => !t.answer);
    return {
      ...session,
      turns,
      feedback: session.feedback ? humanizeAiText(session.feedback) : null,
      questionCount: turns.length,
      currentOrder: pending?.order ?? null,
    };
  }

  private async evaluateSession(roleTitle: string, turns: Turn[]) {
    const transcript = turns
      .map((t) => `Q${t.order}: ${t.question}\nA${t.order}: ${t.answer ?? ''}`)
      .join('\n\n');

    const ai = await this.llm.chatJson<{
      score?: number;
      feedback?: string;
      strengths?: string[];
      improvements?: string[];
    }>([
      {
        role: 'system',
        content:
          'You score a practice interview 0-100. Prefer substance and quantified answers over fluency. Return JSON: score, feedback (2-4 sentences), strengths (string[]), improvements (string[]). Keep feedback actionable. ' +
          HUMAN_CAREER_VOICE,
      },
      {
        role: 'user',
        content: `Role: ${roleTitle}\n\nTranscript:\n${transcript}`,
      },
    ]);

    if (ai && typeof ai.score === 'number') {
      const strengths = Array.isArray(ai.strengths)
        ? ai.strengths.slice(0, 4).map((s) => humanizeAiText(String(s)))
        : [];
      const improvements = Array.isArray(ai.improvements)
        ? ai.improvements.slice(0, 4).map((s) => humanizeAiText(String(s)))
        : [];
      const parts = [
        ai.feedback ? humanizeAiText(ai.feedback) : null,
        strengths.length ? `Strengths: ${strengths.join('; ')}` : null,
        improvements.length ? `Work on: ${improvements.join('; ')}` : null,
      ].filter(Boolean);

      return {
        score: Math.max(1, Math.min(98, Math.round(ai.score))),
        feedback: humanizeAiText(
          parts.join(' ') ||
            'Solid content with room to sharpen delivery and use concrete metrics.',
        ),
      };
    }

    const avgLen =
      turns.reduce((n, t) => n + (t.answer?.length ?? 0), 0) /
      Math.max(1, turns.length);
    const score = 58 + Math.min(30, Math.floor(avgLen / 25));
    return {
      score,
      feedback:
        'Solid content with room to sharpen delivery. Use concrete metrics and keep answers under two minutes.',
    };
  }
}
