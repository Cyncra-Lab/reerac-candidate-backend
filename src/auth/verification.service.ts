import {
  Injectable,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
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

    if (!this.resend) {
      this.logger.error(
        `RESEND_API_KEY missing — OTP for ${normalized} not emailed (code=${code})`,
      );
      throw new ServiceUnavailableException(
        'Email delivery is not configured. Please try again later.',
      );
    }

    const { data, error } = await this.resend.emails.send({
      from: this.config.resendFromEmail,
      to: normalized,
      subject,
      text,
    });

    if (error) {
      this.logger.error(
        `Resend OTP failed for ${normalized}: ${error.message}`,
      );
      throw new ServiceUnavailableException(
        'Could not send verification email. Please try again shortly.',
      );
    }

    this.logger.log(`OTP emailed to ${normalized} (id=${data?.id ?? 'n/a'})`);
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
