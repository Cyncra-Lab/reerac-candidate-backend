import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CandidateAccountStatus, PaymentSku } from '@prisma/client';
import { ServiceAuthGuard } from './service-auth.guard.js';
import { InternalAdminService } from './internal-admin.service.js';

@Controller('internal/admin')
@UseGuards(ServiceAuthGuard)
export class InternalAdminController {
  constructor(private readonly admin: InternalAdminService) {}

  @Get('health')
  health() {
    return this.admin.health();
  }

  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  @Get('candidates')
  listCandidates(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('accountStatus') accountStatus?: CandidateAccountStatus,
  ) {
    return this.admin.listCandidates({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      search,
      accountStatus,
    });
  }

  @Get('candidates/export')
  exportCandidates(@Query('limit') limit?: string) {
    return this.admin.exportCandidatesCsv(
      limit ? Number(limit) : 5000,
    );
  }

  @Get('candidates/:id')
  getCandidate(@Param('id') id: string) {
    return this.admin.getCandidate(id);
  }

  @Patch('candidates/:id/status')
  setStatus(
    @Param('id') id: string,
    @Body() body: { accountStatus: 'ACTIVE' | 'SUSPENDED'; reason?: string },
  ) {
    return this.admin.setCandidateStatus(
      id,
      body.accountStatus,
      body.reason,
    );
  }

  @Post('candidates/:id/clear-sessions')
  clearSessions(@Param('id') id: string) {
    return this.admin.clearSessions(id);
  }

  @Post('candidates/:id/reset-trials')
  resetTrials(@Param('id') id: string) {
    return this.admin.resetTrials(id);
  }

  @Patch('candidates/:id/entitlements')
  adjustEntitlement(
    @Param('id') id: string,
    @Body()
    body: { sku: PaymentSku; remaining: number; expiresAt?: string | null },
  ) {
    return this.admin.adjustEntitlement(
      id,
      body.sku,
      body.remaining,
      body.expiresAt,
    );
  }

  @Patch('candidates/:id/verification')
  setVerification(
    @Param('id') id: string,
    @Body() body: { verified: boolean },
  ) {
    return this.admin.setVerification(id, body.verified);
  }

  @Patch('candidates/:id/visibility-boost')
  setBoost(
    @Param('id') id: string,
    @Body() body: { until: string | null },
  ) {
    return this.admin.setVisibilityBoost(id, body.until);
  }

  @Post('candidates/:id/wipe-coach-threads')
  wipeCoach(@Param('id') id: string) {
    return this.admin.wipeCoachThreads(id);
  }

  @Get('marketing/audience')
  marketingAudience(
    @Query('limit') limit?: string,
    @Query('accountStatus') accountStatus?: CandidateAccountStatus,
    @Query('roleInterest') roleInterest?: string,
    @Query('optInOnly') optInOnly?: string,
  ) {
    return this.admin.listMarketingAudience({
      limit: limit ? Number(limit) : undefined,
      accountStatus,
      roleInterest,
      optInOnly: optInOnly !== 'false',
    });
  }

  @Get('payments')
  listPayments(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.admin.listPayments({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      status,
      search,
    });
  }

  @Patch('payments/:id/refund')
  refundPayment(@Param('id') id: string) {
    return this.admin.markPaymentRefunded(id);
  }

  @Get('job-listings')
  listListings(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('hidden') hidden?: string,
  ) {
    return this.admin.listJobListings({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      search,
      status,
      hidden:
        hidden === 'true' ? true : hidden === 'false' ? false : undefined,
    });
  }

  @Patch('job-listings/:id/hidden')
  setListingHidden(
    @Param('id') id: string,
    @Body() body: { hidden: boolean },
  ) {
    return this.admin.setJobListingHidden(id, body.hidden);
  }

  @Get('automations')
  automations() {
    return this.admin.listAutomations();
  }

  @Patch('automations/:campaign')
  setAutomation(
    @Param('campaign') campaign: string,
    @Body() body: { enabled: boolean; updatedBy?: string },
  ) {
    return this.admin.setAutomationEnabled(
      campaign,
      body.enabled,
      body.updatedBy,
    );
  }

  @Get('pricing-catalog')
  pricingCatalog() {
    return this.admin.getPricingCatalog();
  }
}
