import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PaymentSku } from '@prisma/client';
import { createHmac } from 'crypto';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppConfigService } from '../config/config.service.js';
import { ToolsService } from '../tools/tools.service.js';

const SKU_CATALOG: Record<
  PaymentSku,
  { amountNgn: number; name: string; unitLabel: string; description: string }
> = {
  VISIBILITY_BOOST: {
    amountNgn: 7500,
    name: 'Visibility Boost',
    unitLabel: '30 days',
    description:
      'Your profile ranks first for recruiters when matching jobs are posted.',
  },
  PROFILE_VERIFICATION: {
    amountNgn: 5000,
    name: 'Profile Verification',
    unitLabel: 'one-time',
    description:
      'Verified badge on your profile so recruiters know your identity is confirmed.',
  },
  CV_OPTIMIZATION: {
    amountNgn: 5000,
    name: 'CV Scoring / CV Revamp',
    unitLabel: 'per revamp',
    description:
      'AI keyword alignment, structure fixes, and ATS-friendly export after your free CV Score.',
  },
  LINKEDIN_HANDOFF: {
    amountNgn: 10000,
    name: 'LinkedIn Profile Revamp',
    unitLabel: 'per profile',
    description:
      'Rep-assisted LinkedIn rewrite — headline, About, experience, and searchability.',
  },
  MOCK_INTERVIEW_PACK: {
    amountNgn: 15000,
    name: 'AI Mock Interview',
    unitLabel: '3 sessions',
    description:
      'Practice interview turns with scored feedback and a clear improvement list.',
  },
  PREMIUM_WHATSAPP: {
    amountNgn: 3000,
    name: 'Premium WhatsApp jobs',
    unitLabel: 'per month',
    description:
      'Daily job posts across Nigerian, remote, and international roles.',
  },
  ALL_ACCESS: {
    amountNgn: 45000,
    name: 'All-Access Bundle',
    unitLabel: 'per month',
    description:
      'Visibility boost, verification, CV + LinkedIn revamp, unlimited mocks, and premium WhatsApp.',
  },
};

const SKU_ENTITLEMENTS: Partial<Record<PaymentSku, number>> = {
  VISIBILITY_BOOST: 1,
  PROFILE_VERIFICATION: 1,
  MOCK_INTERVIEW_PACK: 3,
  CV_OPTIMIZATION: 1,
  LINKEDIN_HANDOFF: 1,
  PREMIUM_WHATSAPP: 1,
  ALL_ACCESS: 99,
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly tools: ToolsService,
  ) {}

  catalog() {
    return (Object.keys(SKU_CATALOG) as PaymentSku[]).map((sku) => {
      const item = SKU_CATALOG[sku];
      return {
        sku,
        amountNgn: item.amountNgn,
        currency: 'NGN',
        name: item.name,
        unitLabel: item.unitLabel,
        description: item.description,
      };
    });
  }

  async getPayment(candidateId: string, paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, candidateId },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    // If still pending with Paystack ref, try a verify-and-fulfill (webhook lag).
    if (payment.status === 'PENDING' && payment.paystackRef) {
      await this.tryVerifyPaystackReference(payment.paystackRef);
      const refreshed = await this.prisma.payment.findUnique({
        where: { id: paymentId },
      });
      if (refreshed) {
        return this.serializePayment(refreshed);
      }
    }

    return this.serializePayment(payment);
  }

  private serializePayment(payment: {
    id: string;
    sku: PaymentSku;
    status: string;
    amountNgn: number;
    currency: string;
    paidAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: payment.id,
      sku: payment.sku,
      status: payment.status,
      amountNgn: payment.amountNgn,
      currency: payment.currency,
      paidAt: payment.paidAt,
      createdAt: payment.createdAt,
      name: SKU_CATALOG[payment.sku]?.name,
    };
  }

  private async tryVerifyPaystackReference(reference: string) {
    const secret = this.config.paystackSecretKey;
    if (!secret) return;
    try {
      const { data } = await axios.get(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        { headers: { Authorization: `Bearer ${secret}` } },
      );
      if (data?.data?.status === 'success') {
        const payment = await this.prisma.payment.findFirst({
          where: { paystackRef: reference },
        });
        if (payment && payment.status !== 'PAID') {
          await this.fulfillPayment(payment.id);
        }
      }
    } catch (err) {
      this.logger.warn(
        `Paystack verify failed for ${reference}: ${(err as Error).message}`,
      );
    }
  }

  async initializePayment(candidateId: string, sku: PaymentSku) {
    const candidate = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
    });
    if (!candidate) throw new NotFoundException('Candidate not found');

    const amountNgn = SKU_CATALOG[sku]?.amountNgn;
    if (!amountNgn) throw new BadRequestException('Unknown SKU');

    const payment = await this.prisma.payment.create({
      data: {
        candidateId,
        sku,
        amountNgn,
        status: 'PENDING',
      },
    });

    const secret = this.config.paystackSecretKey;
    if (!secret) {
      await this.fulfillPayment(payment.id);
      return {
        paymentId: payment.id,
        mode: 'dev_auto_fulfill',
        authorizationUrl: null,
      };
    }

    const reference = `cand_${payment.id}`;
    const { data } = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: candidate.email,
        amount: amountNgn * 100,
        reference,
        callback_url: `${this.config.frontendUrl}/candidate/billing/callback?paymentId=${payment.id}`,
        metadata: { candidateId, sku, paymentId: payment.id },
      },
      { headers: { Authorization: `Bearer ${secret}` } },
    );

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { paystackRef: reference },
    });

    return {
      paymentId: payment.id,
      mode: 'paystack',
      authorizationUrl: data?.data?.authorization_url,
      reference,
    };
  }

  async verifyPaystackWebhook(rawBody: Buffer, signature: string | undefined) {
    const secret = this.config.paystackSecretKey;
    if (!secret) return false;
    if (!signature) return false;
    const hash = createHmac('sha512', secret).update(rawBody).digest('hex');
    return hash === signature;
  }

  async handlePaystackEvent(event: any) {
    if (event?.event !== 'charge.success') return { ignored: true };
    const reference = event?.data?.reference as string | undefined;
    if (!reference) return { ignored: true };

    const payment = await this.prisma.payment.findFirst({
      where: { paystackRef: reference },
    });
    if (!payment) return { ignored: true };
    if (payment.status === 'PAID') return { alreadyPaid: true };

    await this.fulfillPayment(payment.id);
    return { fulfilled: true, paymentId: payment.id };
  }

  async fulfillPayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status === 'PAID') return payment;

    await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'PAID', paidAt: new Date() },
    });

    const grant = SKU_ENTITLEMENTS[payment.sku] ?? 1;
    await this.prisma.entitlement.upsert({
      where: {
        candidateId_sku: {
          candidateId: payment.candidateId,
          sku: payment.sku,
        },
      },
      create: {
        candidateId: payment.candidateId,
        sku: payment.sku,
        remaining: grant,
      },
      update: {
        remaining: { increment: grant },
      },
    });

    if (payment.sku === 'ALL_ACCESS') {
      for (const bonus of [
        'VISIBILITY_BOOST',
        'PROFILE_VERIFICATION',
      ] as const) {
        await this.prisma.entitlement.upsert({
          where: {
            candidateId_sku: {
              candidateId: payment.candidateId,
              sku: bonus,
            },
          },
          create: {
            candidateId: payment.candidateId,
            sku: bonus,
            remaining: 1,
          },
          update: { remaining: { increment: 1 } },
        });
      }
    }

    if (
      payment.sku === 'VISIBILITY_BOOST' ||
      payment.sku === 'ALL_ACCESS'
    ) {
      const until = new Date();
      until.setDate(until.getDate() + 30);
      await this.prisma.candidate.update({
        where: { id: payment.candidateId },
        data: { visibilityBoostUntil: until },
      });
    }

    if (
      payment.sku === 'PROFILE_VERIFICATION' ||
      payment.sku === 'ALL_ACCESS'
    ) {
      await this.prisma.candidate.update({
        where: { id: payment.candidateId },
        data: { verifiedAt: new Date() },
      });
    }

    if (payment.sku === 'PREMIUM_WHATSAPP' || payment.sku === 'ALL_ACCESS') {
      await this.prisma.whatsAppOptIn.upsert({
        where: { candidateId: payment.candidateId },
        create: {
          candidateId: payment.candidateId,
          phone: '',
          premium: true,
          community: true,
        },
        update: { premium: true },
      });
    }

    if (payment.sku === 'CV_OPTIMIZATION' || payment.sku === 'ALL_ACCESS') {
      await this.tools.runCvOptimization(payment.candidateId);
    }

    if (payment.sku === 'LINKEDIN_HANDOFF' || payment.sku === 'ALL_ACCESS') {
      await this.handoffLinkedIn(payment.candidateId, payment.id);
    }

    const label =
      SKU_CATALOG[payment.sku]?.name ??
      payment.sku.replaceAll('_', ' ').toLowerCase();

    await this.prisma.notification.create({
      data: {
        candidateId: payment.candidateId,
        type: 'PAYMENT_SUCCESS',
        title: 'Purchase confirmed',
        body: `Your ${label} purchase is ready.`,
        link: '/candidate/tools',
      },
    });

    this.logger.log(`Fulfilled payment ${paymentId} (${payment.sku})`);
    return payment;
  }

  private async handoffLinkedIn(candidateId: string, paymentId: string) {
    const candidate = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
    });
    if (!candidate) return;

    const url = this.config.linkedinHandoffWebhookUrl;
    if (url) {
      try {
        await axios.post(url, {
          event: 'candidate.linkedin_revamp',
          candidateId,
          paymentId,
          email: candidate.email,
          name: `${candidate.firstName} ${candidate.lastName}`.trim(),
          phone: candidate.phone,
          linkedInUrl: candidate.linkedInUrl,
        });
      } catch (err) {
        this.logger.warn(
          `LinkedIn handoff webhook failed: ${(err as Error).message}`,
        );
      }
    }

    await this.prisma.notification.create({
      data: {
        candidateId,
        type: 'LINKEDIN_HANDOFF',
        title: 'LinkedIn revamp queued',
        body: 'A Reerac specialist will contact you on WhatsApp to complete your LinkedIn profile rewrite.',
        link: '/candidate/tools',
      },
    });
  }
}
