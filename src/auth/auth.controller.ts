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

  @Get('api/auth/oauth/status')
  oauthStatus() {
    return { google: this.config.isGoogleOAuthConfigured };
  }

  @All('api/auth/*path')
  async handleAuth(@Req() req: Request, @Res() res: Response) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
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
