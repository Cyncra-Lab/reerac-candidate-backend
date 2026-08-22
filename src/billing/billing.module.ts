import { Module } from '@nestjs/common';
import { BillingService } from './billing.service.js';
import { BillingController } from './billing.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { ToolsModule } from '../tools/tools.module.js';

@Module({
  imports: [AuthModule, ToolsModule],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
