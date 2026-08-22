import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

type QuizQuestion = { id: string; prompt: string; options: string[]; answer: number };

export const SKILL_QUIZZES: Record<
  string,
  { label: string; questions: QuizQuestion[] }
> = {
  communication: {
    label: 'Workplace communication',
    questions: [
      {
        id: 'c1',
        prompt: 'A manager asks for a status update in a group chat. Best first reply?',
        options: [
          'Ignore until you have a full report',
          'Share current progress, blockers, and next step',
          'Say everything is fine with no detail',
          'Ask a teammate to reply for you',
        ],
        answer: 1,
      },
      {
        id: 'c2',
        prompt: 'You disagree with feedback in a review. You should:',
        options: [
          'Argue immediately in the meeting',
          'Ask clarifying questions, then follow up in writing',
          'Ignore the feedback',
          'Complain to coworkers first',
        ],
        answer: 1,
      },
      {
        id: 'c3',
        prompt: 'An email to a recruiter should be:',
        options: [
          'Long, with your full life story',
          'Short, specific, and with a clear ask',
          'Written in all caps',
          'Sent without a subject line',
        ],
        answer: 1,
      },
    ],
  },
  excel: {
    label: 'Excel basics',
    questions: [
      {
        id: 'e1',
        prompt: 'Which function adds a range of numbers?',
        options: ['COUNT', 'SUM', 'AVERAGE', 'IF'],
        answer: 1,
      },
      {
        id: 'e2',
        prompt: 'A freeze pane is used to:',
        options: [
          'Lock printed pages',
          'Keep header rows visible while scrolling',
          'Hide formulas',
          'Share the file',
        ],
        answer: 1,
      },
      {
        id: 'e3',
        prompt: 'VLOOKUP is typically used to:',
        options: [
          'Draw charts',
          'Find a value in a table by a key',
          'Send email',
          'Protect a sheet',
        ],
        answer: 1,
      },
    ],
  },
  customer_service: {
    label: 'Customer service',
    questions: [
      {
        id: 's1',
        prompt: 'An angry customer calls. First step?',
        options: [
          'Transfer immediately',
          'Listen, acknowledge, then offer a next step',
          'Explain why they are wrong',
          'Put them on hold without saying anything',
        ],
        answer: 1,
      },
      {
        id: 's2',
        prompt: 'You do not know the answer. You should:',
        options: [
          'Guess so they stay happy',
          'Say you will find out and follow up with a time',
          'Hang up',
          'Blame another team',
        ],
        answer: 1,
      },
      {
        id: 's3',
        prompt: 'SLA means you:',
        options: [
          'Can ignore tickets after hours',
          'Work to agreed response and resolution times',
          'Only serve VIP customers',
          'Never escalate',
        ],
        answer: 1,
      },
    ],
  },
};

@Injectable()
export class AssessmentsService {
  constructor(private readonly prisma: PrismaService) {}

  catalog() {
    return Object.entries(SKILL_QUIZZES).map(([key, quiz]) => ({
      skillKey: key,
      skillLabel: quiz.label,
      questionCount: quiz.questions.length,
    }));
  }

  getQuiz(skillKey: string) {
    const quiz = SKILL_QUIZZES[skillKey];
    if (!quiz) throw new NotFoundException('Assessment not found');
    return {
      skillKey,
      skillLabel: quiz.label,
      questions: quiz.questions.map(({ answer: _a, ...q }) => q),
    };
  }

  async listMine(candidateId: string) {
    return this.prisma.skillAssessment.findMany({
      where: { candidateId },
      orderBy: { completedAt: 'desc' },
    });
  }

  async submit(
    candidateId: string,
    skillKey: string,
    answers: Record<string, number>,
  ) {
    const quiz = SKILL_QUIZZES[skillKey];
    if (!quiz) throw new NotFoundException('Assessment not found');
    if (!answers || typeof answers !== 'object') {
      throw new BadRequestException('answers are required');
    }

    let correct = 0;
    for (const q of quiz.questions) {
      if (Number(answers[q.id]) === q.answer) correct += 1;
    }
    const score = Math.round((correct / quiz.questions.length) * 100);
    const passed = score >= 70;

    return this.prisma.skillAssessment.upsert({
      where: { candidateId_skillKey: { candidateId, skillKey } },
      create: {
        candidateId,
        skillKey,
        skillLabel: quiz.label,
        score,
        passed,
      },
      update: { score, passed, completedAt: new Date() },
    });
  }
}
