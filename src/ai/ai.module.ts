import { Global, Module } from '@nestjs/common';
import { LlmClient } from './llm.client.js';
import { AppConfigModule } from '../config/config.module.js';

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [LlmClient],
  exports: [LlmClient],
})
export class AiModule {}
