import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { randomInt, randomUUID } from 'crypto';
import { Resend } from 'resend';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppConfigService } from '../config/config.service.js';

const OTP_EXPIRY_MINUTES = 10;

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);
  private resend: Resend | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {
    if (this.config.resendApiKey) {
      this.resend = new Resend(this.config.resendApiKey);
    }
  }

  async sendOtp(email: string): Promise<{ message: string }> {
    const normalized = email.toLowerCase().trim();
    const code = String(randomInt(100000, 999999));

    await this.prisma.auth_verification.deleteMany({
      where: { identifier: normalized },
    });

    await this.prisma.auth_verification.create({
      data: {
        id: randomUUID(),
        identifier: normalized,
        value: code,
        expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
      },
    });

    const subject = 'Verify your email — Reerac AI';
    const text = `Your verification code is: ${code}\n\nThis code expires in ${OTP_EXPIRY_MINUTES} minutes.\n\nIf you didn't request this, please ignore this email.\n\n— Reerac AI`;

    if (this.resend) {
      await this.resend.emails.send({
        from: 'Reerac <noreply@reerac.com>',
        to: normalized,
        subject,
        text,
      });
    } else {
      this.logger.warn(
        `OTP for ${normalized} (Resend not configured): ${code}`,
      );
    }

    this.logger.log(`OTP sent to ${normalized}`);
    return { message: 'Verification code sent to your email' };
  }

  async verifyOtp(
    email: string,
    code: string,
  ): Promise<{ verified: boolean }> {
    const normalized = email.toLowerCase().trim();
    const record = await this.prisma.auth_verification.findFirst({
      where: { identifier: normalized },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) {
      throw new BadRequestException(
        'No verification code found. Please request a new one.',
      );
    }

    if (record.expiresAt < new Date()) {
      await this.prisma.auth_verification.delete({ where: { id: record.id } });
      throw new BadRequestException(
        'Verification code has expired. Please request a new one.',
      );
    }

    if (record.value !== code) {
      throw new BadRequestException('Invalid verification code.');
    }

    await this.prisma.auth_user.updateMany({
      where: { email: normalized },
      data: { emailVerified: true },
    });

    await this.prisma.auth_verification.delete({ where: { id: record.id } });

    this.logger.log(`Email verified for ${normalized}`);
    return { verified: true };
  }
}
