import { Module } from '@nestjs/common';
import { B2bClientService } from './b2b-client.service.js';

@Module({
  providers: [B2bClientService],
  exports: [B2bClientService],
})
export class B2bModule {}
