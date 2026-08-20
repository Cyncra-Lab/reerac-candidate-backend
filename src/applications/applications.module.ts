import { Module } from '@nestjs/common';
import { ApplicationsService } from './applications.service.js';
import { ApplicationsController } from './applications.controller.js';
import { B2bModule } from '../b2b/b2b.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [B2bModule, JobsModule, AuthModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
