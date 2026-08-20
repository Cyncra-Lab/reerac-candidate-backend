import {
  All,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { AppConfigService } from '../config/config.service.js';
import { VerificationService } from './verification.service.js';
import { SendOtpDto, VerifyOtpDto } from './dto/verification.dto.js';

@Controller()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: AppConfigService,
    private readonly verification: VerificationService,
  ) {}

  /** Public Google OAuth availability (same-origin via /api/candidate-auth/oauth/status). */
  @Get(['api/auth/oauth/status', 'api/candidate-auth/oauth/status'])
  oauthStatus() {
    return { google: this.config.isGoogleOAuthConfigured };
  }

  /**
   * Better Auth catch-all.
   * Next.js rewrites /api/candidate-auth/* → this service /api/auth/* (or /api/candidate-auth/*).
   * We present the browser-facing URL to Better Auth so it does not 302 to the Railway host
   * (which turns POST into GET and breaks signup).
   */
  @All(['api/auth/*path', 'api/candidate-auth/*path'])
  async handleAuth(@Req() req: Request, @Res() res: Response) {
    const publicBase = this.config.betterAuthUrl.replace(/\/$/, '');
    const rawPath = (req.originalUrl || req.url).split('?')[0] || '';
    const suffix = rawPath
      .replace(/^\/api\/candidate-auth/, '')
      .replace(/^\/api\/auth/, '');
    const publicPath = `/api/candidate-auth${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
    const url = new URL(
      publicPath + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''),
      publicBase.endsWith('/') ? publicBase : `${publicBase}/`,
    );

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
    }
    // Prefer public host for Better Auth cookie / redirect logic
    try {
      headers.set('host', new URL(publicBase).host);
    } catch {
      /* ignore */
    }

    const request = new Request(url.toString(), {
      method: req.method,
      headers,
      body:
        req.method === 'GET' || req.method === 'HEAD'
          ? undefined
          : JSON.stringify(req.body),
    });
    const response = await this.authService.handler(request);
    this.authService.forwardBetterAuthResponse(response, res);
    const body = await response.text();
    res.send(body);
  }

  @Post('auth/send-otp')
  @HttpCode(HttpStatus.OK)
  async sendOtp(@Body() dto: SendOtpDto) {
    return this.verification.sendOtp(dto.email);
  }

  @Post('auth/verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.verification.verifyOtp(dto.email, dto.code);
  }

  @Get('health')
  health() {
    return { ok: true, service: 'candidate-api' };
  }
}
