import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsEnum } from 'class-validator';
import { PaymentSku } from '@prisma/client';
import { BillingService } from './billing.service.js';
import { CandidateAuthGuard } from '../auth/candidate-auth.guard.js';

class InitPaymentDto {
  @IsEnum(PaymentSku)
  sku!: PaymentSku;
}

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('catalog')
  catalog() {
    return this.billing.catalog();
  }

  @Get('payments/:id')
  @UseGuards(CandidateAuthGuard)
  getPayment(@Req() req: any, @Param('id') id: string) {
    return this.billing.getPayment(req.candidate.id, id);
  }

  @Post('initialize')
  @UseGuards(CandidateAuthGuard)
  initialize(@Req() req: any, @Body() dto: InitPaymentDto) {
    return this.billing.initializePayment(req.candidate.id, dto.sku);
  }

  @Post('webhooks/paystack')
  async paystackWebhook(
    @Req() req: any,
    @Headers('x-paystack-signature') signature: string,
    @Body() body: any,
  ) {
    const ok = await this.billing.verifyPaystackWebhook(
      req.rawBody ?? Buffer.from(JSON.stringify(body)),
      signature,
    );
    if (!ok && process.env.PAYSTACK_SECRET_KEY) {
      return { ok: false };
    }
    return this.billing.handlePaystackEvent(body);
  }
}
