import { Module } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { CandidateAuthGuard } from './candidate-auth.guard.js';
import { B2bModule } from '../b2b/b2b.module.js';

@Module({
  imports: [B2bModule],
  controllers: [AuthController],
  providers: [AuthService, CandidateAuthGuard],
  exports: [AuthService, CandidateAuthGuard],
})
export class AuthModule {}
