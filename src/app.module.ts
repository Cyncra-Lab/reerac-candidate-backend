import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AiModule } from './ai/ai.module.js';
import { AuthModule } from './auth/auth.module.js';
import { B2bModule } from './b2b/b2b.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { ApplicationsModule } from './applications/applications.module.js';
import { ProfileModule } from './profile/profile.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { BillingModule } from './billing/billing.module.js';
import { MockInterviewsModule } from './mock-interviews/mock-interviews.module.js';
import { MatchingModule } from './matching/matching.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { EventsModule } from './events/events.module.js';
import { ToolsModule } from './tools/tools.module.js';
import { AssessmentsModule } from './assessments/assessments.module.js';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    AiModule,
    AuthModule,
    B2bModule,
    JobsModule,
    ApplicationsModule,
    ProfileModule,
    DashboardModule,
    BillingModule,
    MockInterviewsModule,
    MatchingModule,
    NotificationsModule,
    EventsModule,
    ToolsModule,
    AssessmentsModule,
  ],
})
export class AppModule {}
