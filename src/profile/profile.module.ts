import { Module } from '@nestjs/common';
import { ProfileService } from './profile.service.js';
import { ProfileController } from './profile.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { B2bModule } from '../b2b/b2b.module.js';

@Module({
  imports: [AuthModule, B2bModule],
  controllers: [ProfileController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class ProfileModule {}
