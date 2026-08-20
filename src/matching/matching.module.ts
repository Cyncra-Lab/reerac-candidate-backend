import { Module } from '@nestjs/common';
import { MatchingService } from './matching.service.js';
import { MatchingController } from './matching.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [MatchingController],
  providers: [MatchingService],
  exports: [MatchingService],
})
export class MatchingModule {}
