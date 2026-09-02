import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    try {
      await Promise.race([
        this.$connect(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Database connect timed out after 45s')),
            45_000,
          ),
        ),
      ]);
    } catch (err) {
      this.logger.error(
        `Could not connect to the database: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
