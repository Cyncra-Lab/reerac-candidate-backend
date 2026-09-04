import { Module } from '@nestjs/common';
import { InternalAdminController } from './internal-admin.controller.js';
import { InternalAdminService } from './internal-admin.service.js';
import { ServiceAuthGuard } from './service-auth.guard.js';

@Module({
  controllers: [InternalAdminController],
  providers: [InternalAdminService, ServiceAuthGuard],
  exports: [InternalAdminService],
})
export class InternalAdminModule {}
