import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: NestConfigService) {}

  get port(): number {
    return this.config.get<number>('PORT', 4100);
  }

  get frontendUrl(): string {
    return this.config.get<string>('FRONTEND_URL', 'http://localhost:3000');
  }

  get betterAuthSecret(): string {
    return this.config.get<string>('BETTER_AUTH_SECRET', 'dev-secret')!;
  }

  get betterAuthUrl(): string {
    // Must be the browser-facing site origin (Next), not the Railway API host.
    // Auth is served via Next rewrite at /api/candidate-auth.
    return this.config.get<string>(
      'BETTER_AUTH_URL',
      this.frontendUrl,
    )!;
  }

  get betterAuthTrustedOrigins(): string[] {
    return (this.config.get<string>('BETTER_AUTH_TRUSTED_ORIGINS', '') ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }

  get isGoogleOAuthConfigured(): boolean {
    return Boolean(
      this.config.get('GOOGLE_CLIENT_ID') &&
        this.config.get('GOOGLE_CLIENT_SECRET'),
    );
  }

  get googleClientId(): string | undefined {
    return this.config.get<string>('GOOGLE_CLIENT_ID');
  }

  get googleClientSecret(): string | undefined {
    return this.config.get<string>('GOOGLE_CLIENT_SECRET');
  }

  get b2bApiUrl(): string {
    return this.config.get<string>('B2B_API_URL', 'http://localhost:4000/v1')!;
  }

  get b2bServiceToken(): string {
    return this.config.get<string>('B2B_SERVICE_TOKEN', 'dev-b2b-service-token')!;
  }

  get redisUrl(): string {
    return this.config.get<string>('REDIS_URL', 'redis://localhost:6379')!;
  }

  get paystackSecretKey(): string {
    return this.config.get<string>('PAYSTACK_SECRET_KEY', '')!;
  }

  get whatsappHandoffWebhookUrl(): string | undefined {
    return this.config.get<string>('WHATSAPP_HANDOFF_WEBHOOK_URL');
  }

  get linkedinHandoffWebhookUrl(): string | undefined {
    return (
      this.config.get<string>('LINKEDIN_HANDOFF_WEBHOOK_URL') ??
      this.config.get<string>('WHATSAPP_HANDOFF_WEBHOOK_URL')
    );
  }

  get resendApiKey(): string {
    return this.config.get<string>('RESEND_API_KEY', '')!;
  }

  get resendFromEmail(): string {
    return (
      this.config.get<string>('RESEND_FROM_EMAIL') ??
      'Reerac AI <no-reply@notifications.reerac.ng>'
    );
  }

  get lifecycleCronSecret(): string {
    return this.config.get<string>('LIFECYCLE_CRON_SECRET', '')!;
  }

  get groqApiKey(): string {
    return this.config.get<string>('GROQ_API_KEY', '')!;
  }

  get openaiApiKey(): string {
    return this.config.get<string>('OPENAI_API_KEY', '')!;
  }

  get llmModel(): string {
    return (
      this.config.get<string>('CANDIDATE_LLM_MODEL') ??
      this.config.get<string>('GROQ_CHAT_MODEL') ??
      'llama-3.3-70b-versatile'
    );
  }

  get isLlmConfigured(): boolean {
    return Boolean(this.groqApiKey || this.openaiApiKey);
  }
}
