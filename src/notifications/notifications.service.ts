import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppConfigService } from '../config/config.service.js';
import { Resend } from 'resend';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private resend: Resend | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {
    if (this.config.resendApiKey) {
      this.resend = new Resend(this.config.resendApiKey);
    }
  }

  list(candidateId: string) {
    return this.prisma.notification.findMany({
      where: { candidateId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markRead(candidateId: string, id: string) {
    return this.prisma.notification.updateMany({
      where: { id, candidateId },
      data: { readAt: new Date() },
    });
  }

  async setLifecycleEmailOptIn(candidateId: string, optedIn: boolean) {
    return this.prisma.candidate.update({
      where: { id: candidateId },
      data: { lifecycleEmailOptIn: optedIn },
      select: { id: true, lifecycleEmailOptIn: true },
    });
  }

  private async recentlySent(
    candidateId: string,
    campaign: string,
    withinMs: number,
  ) {
    const since = new Date(Date.now() - withinMs);
    const row = await this.prisma.notificationCampaignLog.findFirst({
      where: { candidateId, campaign, sentAt: { gte: since } },
    });
    return Boolean(row);
  }

  private async sendEmail(to: string, subject: string, body: string) {
    if (!this.resend) {
      this.logger.debug(`Email skipped (no Resend): ${subject} -> ${to}`);
      return;
    }
    await this.resend.emails.send({
      from: this.config.resendFromEmail,
      to,
      subject,
      text: body,
    });
  }

  private async isAutomationEnabled(campaign: string): Promise<boolean> {
    const row = await this.prisma.notificationAutomationSetting.findUnique({
      where: { campaign },
    });
    // Default enabled when no row yet
    return row?.enabled ?? true;
  }

  /** Lifecycle campaigns: low CV score, mock lapsed, placed re-engagement. */
  async runLifecycleCampaigns() {
    const week = 7 * 24 * 60 * 60 * 1000;
    const month = 30 * 24 * 60 * 60 * 1000;
    const sixMonths = 180 * 24 * 60 * 60 * 1000;
    let sent = 0;

    const candidates = await this.prisma.candidate.findMany({
      where: { lifecycleEmailOptIn: true },
      include: {
        cvScores: { orderBy: { createdAt: 'desc' }, take: 1 },
        mockSessions: { orderBy: { createdAt: 'desc' }, take: 1 },
        applications: { where: { status: 'HIRED' }, take: 1 },
        entitlements: true,
      },
      take: 200,
    });

    for (const c of candidates) {
      const score = c.cvScores[0]?.overallScore;
      const hasOpt = c.entitlements.some(
        (e) => e.sku === 'CV_OPTIMIZATION' && e.remaining > 0,
      );
      if (score != null && score < 70 && !hasOpt) {
        if (
          (await this.isAutomationEnabled('LOW_CV_SCORE')) &&
          !(await this.recentlySent(c.id, 'LOW_CV_SCORE', week))
        ) {
          await this.dispatch(c.id, c.email, c.firstName, {
            campaign: 'LOW_CV_SCORE',
            title: 'Improve your CV score',
            body: `Hi ${c.firstName}, your CV score is ${score}. Optimize it to stand out to recruiters.`,
          });
          sent++;
        }
      }

      const lastMock = c.mockSessions[0];
      if (
        lastMock &&
        Date.now() - lastMock.createdAt.getTime() > month
      ) {
        if (
          (await this.isAutomationEnabled('MOCK_LAPSED')) &&
          !(await this.recentlySent(c.id, 'MOCK_LAPSED', month))
        ) {
          await this.dispatch(c.id, c.email, c.firstName, {
            campaign: 'MOCK_LAPSED',
            title: 'Keep your interview skills sharp',
            body: `Hi ${c.firstName}, it's been a while since your last mock interview. Book another session to stay ready.`,
          });
          sent++;
        }
      }

      const hired = c.applications[0];
      if (
        hired &&
        Date.now() - hired.updatedAt.getTime() > sixMonths
      ) {
        if (
          (await this.isAutomationEnabled('PLACED_REENGAGE')) &&
          !(await this.recentlySent(c.id, 'PLACED_REENGAGE', sixMonths))
        ) {
          await this.dispatch(c.id, c.email, c.firstName, {
            campaign: 'PLACED_REENGAGE',
            title: 'Refresh your profile',
            body: `Hi ${c.firstName}, update your CV and LinkedIn so you're ready for the next opportunity.`,
          });
          sent++;
        }
      }
    }

    return { sent };
  }

  async runMatchDigests() {
    const week = 7 * 24 * 60 * 60 * 1000;
    const day = 24 * 60 * 60 * 1000;
    let sent = 0;
    const candidates = await this.prisma.candidate.findMany({
      where: { accountStatus: 'ACTIVE' },
      include: {
        entitlements: true,
        matchScores: {
          include: { jobListing: true },
          orderBy: { matchPercent: 'desc' },
          take: 5,
        },
      },
      take: 300,
    });

    for (const c of candidates) {
      if (!c.matchScores.length) continue;
      const premium = c.entitlements.some(
        (e) =>
          (e.sku === 'PREMIUM_WHATSAPP' || e.sku === 'ALL_ACCESS') &&
          e.remaining > 0,
      );
      const campaign = premium ? 'MATCH_DIGEST_DAILY' : 'MATCH_DIGEST_WEEKLY';
      if (!(await this.isAutomationEnabled(campaign))) continue;
      const window = premium ? day : week;
      if (await this.recentlySent(c.id, campaign, window)) continue;
      if (!c.lifecycleEmailOptIn && !premium) continue;

      const lines = c.matchScores
        .map(
          (m) =>
            `• ${m.jobListing.title} at ${m.jobListing.companyName} — ${m.matchPercent}% match`,
        )
        .join('\n');
      await this.dispatch(c.id, c.email, c.firstName, {
        campaign,
        title: premium ? 'Your daily job matches' : 'Your weekly job matches',
        body: `Hi ${c.firstName}, here are roles that fit your profile:\n${lines}\n\nOpen Reerac to apply.`,
      });
      sent++;
    }
    return { sent };
  }

  unreadCount(candidateId: string) {
    return this.prisma.notification.count({
      where: { candidateId, readAt: null },
    });
  }

  private async dispatch(
    candidateId: string,
    email: string,
    firstName: string,
    payload: { campaign: string; title: string; body: string },
  ) {
    await this.prisma.notification.create({
      data: {
        candidateId,
        type: payload.campaign,
        title: payload.title,
        body: payload.body,
        link: '/candidate/applications',
      },
    });
    await this.prisma.notificationCampaignLog.create({
      data: { candidateId, campaign: payload.campaign },
    });
    await this.sendEmail(email, payload.title, payload.body);
    this.logger.log(
      `Lifecycle ${payload.campaign} -> ${firstName} (${candidateId})`,
    );
  }
}
