import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { B2bClientService } from '../b2b/b2b-client.service.js';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly b2b: B2bClientService,
  ) {}

  async syncFromB2b() {
    try {
      const result = await this.b2b.listActiveJobs({ limit: 100 });
      const jobs = result.data ?? [];
      for (const job of jobs) {
        await this.upsertListing(job);
      }
      this.logger.log(`Synced ${jobs.length} jobs from B2B`);
      return { synced: jobs.length };
    } catch (err) {
      this.logger.warn(`Job sync failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async upsertListing(job: {
    id: string;
    title: string;
    department?: string;
    location?: string;
    workMode?: string;
    type?: string;
    salaryMin?: number;
    salaryMax?: number;
    currency?: string;
    description?: string;
    requirements?: string[];
    responsibilities?: string[];
    status?: string;
    closingDate?: string;
    hiringCompanyName?: string | null;
    company?: { name?: string } | null;
  }) {
    const companyName =
      job.hiringCompanyName?.trim() ||
      job.company?.name?.trim() ||
      'Hiring company';

    return this.prisma.jobListing.upsert({
      where: { b2bJobId: job.id },
      create: {
        id: job.id,
        b2bJobId: job.id,
        companyName,
        title: job.title,
        department: job.department ?? null,
        location: job.location ?? null,
        workMode: job.workMode ?? null,
        type: job.type ?? null,
        salaryMin: job.salaryMin ?? null,
        salaryMax: job.salaryMax ?? null,
        currency: job.currency ?? 'NGN',
        description: job.description ?? '',
        requirements: job.requirements ?? [],
        responsibilities: job.responsibilities ?? [],
        status: job.status ?? 'ACTIVE',
        closingDate: job.closingDate ? new Date(job.closingDate) : null,
        syncedAt: new Date(),
      },
      update: {
        companyName,
        title: job.title,
        department: job.department ?? null,
        location: job.location ?? null,
        workMode: job.workMode ?? null,
        type: job.type ?? null,
        salaryMin: job.salaryMin ?? null,
        salaryMax: job.salaryMax ?? null,
        currency: job.currency ?? 'NGN',
        description: job.description ?? '',
        requirements: job.requirements ?? [],
        responsibilities: job.responsibilities ?? [],
        status: job.status ?? 'ACTIVE',
        closingDate: job.closingDate ? new Date(job.closingDate) : null,
        syncedAt: new Date(),
      },
    });
  }

  async list(params: { search?: string; page?: number; limit?: number }) {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 20, 100);
    const where: any = { status: 'ACTIVE' };
    if (params.search) {
      where.OR = [
        { title: { contains: params.search, mode: 'insensitive' } },
        { location: { contains: params.search, mode: 'insensitive' } },
        { companyName: { contains: params.search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await Promise.all([
      this.prisma.jobListing.findMany({
        where,
        orderBy: { syncedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.jobListing.count({ where }),
    ]);
    return {
      data,
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  async getById(id: string) {
    let listing = await this.prisma.jobListing.findFirst({
      where: { OR: [{ id }, { b2bJobId: id }] },
    });
    if (!listing) {
      try {
        const remote = await this.b2b.getJob(id);
        listing = await this.upsertListing(remote);
      } catch {
        throw new NotFoundException('Job not found');
      }
    }
    return listing;
  }
}
