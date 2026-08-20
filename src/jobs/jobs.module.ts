import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service.js';
import { JobsController } from './jobs.controller.js';
import { B2bModule } from '../b2b/b2b.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [B2bModule, AuthModule],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
