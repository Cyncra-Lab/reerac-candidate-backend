import { Module } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { CandidateAuthGuard } from './candidate-auth.guard.js';
import { VerificationService } from './verification.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, CandidateAuthGuard, VerificationService],
  exports: [AuthService, CandidateAuthGuard, VerificationService],
})
export class AuthModule {}
