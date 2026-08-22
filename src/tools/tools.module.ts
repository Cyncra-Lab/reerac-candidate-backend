import { Module } from '@nestjs/common';
import { ToolsController } from './tools.controller.js';
import { ToolsService } from './tools.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { JobsModule } from '../jobs/jobs.module.js';

@Module({
  imports: [AuthModule, JobsModule],
  controllers: [ToolsController],
  providers: [ToolsService],
  exports: [ToolsService],
})
export class ToolsModule {}
