import { Module } from '@nestjs/common';
import { MockInterviewsService } from './mock-interviews.service.js';
import { MockInterviewsController } from './mock-interviews.controller.js';
import { AuthModule } from '../auth/auth.module.js';

/** Practice interviews generated from a candidate role + resume. */
@Module({
  imports: [AuthModule],
  controllers: [MockInterviewsController],
  providers: [MockInterviewsService],
})
export class MockInterviewsModule {}
