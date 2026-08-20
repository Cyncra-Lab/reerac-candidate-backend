import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { LlmClient } from '../ai/llm.client.js';

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

  async start(candidateId: string, roleTitle: string) {
    const entitlement = await this.prisma.entitlement.findUnique({
      where: {
        candidateId_sku: {
          candidateId,
          sku: 'MOCK_INTERVIEW_PACK',
        },
      },
    });
    const allAccess = await this.prisma.entitlement.findUnique({
      where: {
        candidateId_sku: { candidateId, sku: 'ALL_ACCESS' },
      },
    });

    const packRemaining = entitlement?.remaining ?? 0;
    const hasAllAccess = (allAccess?.remaining ?? 0) > 0;

    if (packRemaining <= 0 && !hasAllAccess) {
      throw new BadRequestException(
        'No mock interview credits. Purchase a pack (3 sessions for ₦15,000).',
      );
    }

    // All-Access = unlimited mocks for the period — do not decrement.
    if (packRemaining > 0) {
      await this.prisma.entitlement.update({
        where: { id: entitlement!.id },
        data: { remaining: { decrement: 1 } },
      });
    }

    const questions = await this.buildQuestions(roleTitle);

    return this.prisma.mockInterviewSession.create({
      data: {
        candidateId,
        roleTitle,
        status: 'IN_PROGRESS',
        startedAt: new Date(),
        turns: questions.map((q, i) => ({
          order: i + 1,
          question: q,
          answer: null,
        })),
      },
    });
  }

  private async buildQuestions(roleTitle: string): Promise<string[]> {
    const fallback = [
      `Tell me about yourself and why you're interested in ${roleTitle}.`,
      'Walk me through a recent project you led and the measurable outcome.',
      'Describe a difficult stakeholder or team situation and how you handled it.',
    ];

    const ai = await this.llm.chatJson<{ questions?: string[] }>(
      [
        {
          role: 'system',
          content:
            'You are a concise interviewer. Return JSON { "questions": string[3] }. Each question should sound like a real interviewer (short). Focus on substance and quantifiable impact.',
        },
        {
          role: 'user',
          content: `Generate 3 interview questions for the role: ${roleTitle}`,
        },
      ],
      { temperature: 0.5, maxTokens: 500 },
    );

    if (Array.isArray(ai?.questions) && ai.questions.length >= 3) {
      return ai.questions.slice(0, 3).map(String);
    }
    return fallback;
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

    const turns = Array.isArray(session.turns)
      ? (session.turns as Array<{
          order: number;
          question: string;
          answer: string | null;
        }>)
      : [];
    const next = turns.map((t) =>
      t.order === dto.order ? { ...t, answer: dto.answer } : t,
    );
    const allAnswered = next.every((t) => t.answer && t.answer.trim());

    if (!allAnswered) {
      return this.prisma.mockInterviewSession.update({
        where: { id: sessionId },
        data: { turns: next },
      });
    }

    const evaluation = await this.evaluateSession(session.roleTitle, next);

    return this.prisma.mockInterviewSession.update({
      where: { id: sessionId },
      data: {
        turns: next,
        status: 'COMPLETED',
        completedAt: new Date(),
        score: evaluation.score,
        feedback: evaluation.feedback,
      },
    });
  }

  private async evaluateSession(
    roleTitle: string,
    turns: Array<{ order: number; question: string; answer: string | null }>,
  ) {
    const transcript = turns
      .map(
        (t) =>
          `Q${t.order}: ${t.question}\nA${t.order}: ${t.answer ?? ''}`,
      )
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
          'You score mock interviews 0-100. Prefer substance and quantified answers over fluency. Return JSON: score, feedback (2-4 sentences), strengths (string[]), improvements (string[]). Keep feedback actionable.',
      },
      {
        role: 'user',
        content: `Role: ${roleTitle}\n\nTranscript:\n${transcript}`,
      },
    ]);

    if (ai && typeof ai.score === 'number') {
      const strengths = Array.isArray(ai.strengths)
        ? ai.strengths.slice(0, 4).map(String)
        : [];
      const improvements = Array.isArray(ai.improvements)
        ? ai.improvements.slice(0, 4).map(String)
        : [];
      const parts = [
        ai.feedback?.trim(),
        strengths.length ? `Strengths: ${strengths.join('; ')}` : null,
        improvements.length
          ? `Work on: ${improvements.join('; ')}`
          : null,
      ].filter(Boolean);

      return {
        score: Math.max(1, Math.min(98, Math.round(ai.score))),
        feedback:
          parts.join(' ') ||
          'Solid content with room to sharpen delivery and use concrete metrics.',
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
