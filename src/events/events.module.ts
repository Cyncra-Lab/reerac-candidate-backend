import { Module } from '@nestjs/common';
import { EventsConsumerService } from './events.consumer.js';
import { ApplicationsModule } from '../applications/applications.module.js';
import { JobsModule } from '../jobs/jobs.module.js';

@Module({
  imports: [ApplicationsModule, JobsModule],
  providers: [EventsConsumerService],
})
export class EventsModule {}
