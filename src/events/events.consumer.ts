import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../config/config.service.js';
import { ApplicationsService } from '../applications/applications.service.js';
import { JobsService } from '../jobs/jobs.service.js';

const STREAM_KEY = 'reerac:b2b:events';
const GROUP = 'candidate-api';
const CONSUMER = `cand-${process.pid}`;

@Injectable()
export class EventsConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventsConsumerService.name);
  private redis: Redis | null = null;
  private running = false;

  constructor(
    private readonly config: AppConfigService,
    private readonly applications: ApplicationsService,
    private readonly jobs: JobsService,
  ) {}

  async onModuleInit() {
    try {
      const redis = new Redis(this.config.redisUrl, {
        maxRetriesPerRequest: null,
        lazyConnect: true,
      });
      await redis.connect();
      await redis.ping();
      this.redis = redis;
      try {
        await redis.xgroup('CREATE', STREAM_KEY, GROUP, '0', 'MKSTREAM');
      } catch {
        // group may already exist
      }
      this.running = true;
      void this.loop();
      this.logger.log('B2B event consumer started');
    } catch (err) {
      this.logger.warn(
        `Event consumer disabled (Redis unavailable): ${(err as Error).message}`,
      );
    }
  }

  async onModuleDestroy() {
    this.running = false;
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
  }

  private async loop() {
    while (this.running && this.redis) {
      try {
        const result = (await this.redis.xreadgroup(
          'GROUP',
          GROUP,
          CONSUMER,
          'COUNT',
          10,
          'BLOCK',
          5000,
          'STREAMS',
          STREAM_KEY,
          '>',
        )) as Array<[string, Array<[string, string[]]>]> | null;

        if (!result) continue;
        for (const [, messages] of result) {
          for (const [id, fields] of messages) {
            await this.handle(id, fields);
            await this.redis.xack(STREAM_KEY, GROUP, id);
          }
        }
      } catch (err) {
        this.logger.warn(`Event loop error: ${(err as Error).message}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  private async handle(id: string, fields: string[]) {
    const map: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      map[fields[i]!] = fields[i + 1]!;
    }
    const type = map.type;
    const payload = map.payload ? JSON.parse(map.payload) : {};

    this.logger.debug(`Event ${id} type=${type}`);

    if (
      type === 'application.status.changed' ||
      type === 'application.created'
    ) {
      await this.applications.applyStatusFromEvent({
        eventId: id,
        b2bApplicantId: payload.applicantId,
        status: payload.status,
        cvScanStatus: payload.cvScanStatus,
        externalCandidateId: payload.externalCandidateId,
        jobId: payload.jobId,
        email: payload.email,
      });
    }

    if (
      type === 'interview.completed' ||
      type === 'interview.scheduled' ||
      type === 'interview.incomplete'
    ) {
      const status =
        type === 'interview.completed'
          ? 'INTERVIEW_COMPLETE'
          : type === 'interview.scheduled'
            ? 'INTERVIEW_SCHEDULED'
            : 'INTERVIEW_SCHEDULED';
      if (payload.applicantId) {
        await this.applications.applyStatusFromEvent({
          eventId: id,
          b2bApplicantId: payload.applicantId,
          status,
          externalCandidateId: payload.externalCandidateId,
        });
      }
    }

    if (type === 'job.updated' || type === 'job.closed') {
      if (payload.job) {
        await this.jobs.upsertListing(payload.job);
      } else if (type === 'job.closed' && payload.jobId) {
        await this.jobs.upsertListing({
          id: payload.jobId,
          title: payload.title ?? 'Closed role',
          status: 'CLOSED',
          description: '',
        });
      }
    }
  }
}
