import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { B2bClientService } from '../b2b/b2b-client.service.js';

export type JobListParams = {
  search?: string;
  page?: number;
  limit?: number;
  workMode?: string;
  type?: string;
  location?: string;
  minSalary?: number;
  minMatch?: number;
  forYou?: boolean;
  sort?: 'match' | 'recent';
  candidateId?: string;
};

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
    source?: 'NATIVE' | 'EXTERNAL';
    sourceName?: string | null;
    sourceUrl?: string | null;
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
        source: job.source ?? 'NATIVE',
        sourceName: job.sourceName ?? 'Reerac',
        sourceUrl: job.sourceUrl ?? null,
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
        ...(job.source ? { source: job.source } : {}),
        ...(job.sourceName !== undefined ? { sourceName: job.sourceName } : {}),
        ...(job.sourceUrl !== undefined ? { sourceUrl: job.sourceUrl } : {}),
        syncedAt: new Date(),
      },
    });
  }

  async list(params: JobListParams) {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 20, 100);
    const where: Prisma.JobListingWhereInput = { status: 'ACTIVE' };
    const and: Prisma.JobListingWhereInput[] = [];
    if (params.search) {
      and.push({
        OR: [
          { title: { contains: params.search, mode: 'insensitive' } },
          { location: { contains: params.search, mode: 'insensitive' } },
          { companyName: { contains: params.search, mode: 'insensitive' } },
        ],
      });
    }
    if (params.workMode) {
      where.workMode = { equals: params.workMode, mode: 'insensitive' };
    }
    if (params.type) where.type = { equals: params.type, mode: 'insensitive' };
    if (params.location) {
      where.location = { contains: params.location, mode: 'insensitive' };
    }
    if (params.minSalary != null && !Number.isNaN(params.minSalary)) {
      and.push({
        OR: [
          { salaryMin: { gte: params.minSalary } },
          { salaryMax: { gte: params.minSalary } },
        ],
      });
    }
    if (and.length) where.AND = and;

    let data = await this.prisma.jobListing.findMany({
      where,
      orderBy: { syncedAt: 'desc' },
    });

    const decorated = await this.decorateListings(data, params.candidateId);

    let rows = decorated;
    if (params.minMatch != null && params.candidateId) {
      rows = rows.filter((j) => (j.matchPercent ?? 0) >= params.minMatch!);
    }

    if (params.forYou && params.candidateId) {
      const prefs = await this.prisma.candidateJobPreference.findUnique({
        where: { candidateId: params.candidateId },
      });
      rows = rows
        .map((job) => ({
          ...job,
          forYouScore: this.preferenceScore(job, prefs) + (job.matchPercent ?? 40),
        }))
        .sort((a, b) => b.forYouScore - a.forYouScore);
    } else if (params.sort === 'match' && params.candidateId) {
      rows = [...rows].sort(
        (a, b) => (b.matchPercent ?? 0) - (a.matchPercent ?? 0),
      );
    }

    const total = rows.length;
    const paged = rows.slice((page - 1) * limit, page * limit);
    return {
      data: paged,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  private preferenceScore(
    job: {
      title: string;
      location?: string | null;
      workMode?: string | null;
      salaryMin?: number | null;
      salaryMax?: number | null;
    },
    prefs: {
      roleFamilies: string[];
      locations: string[];
      workModes: string[];
      salaryFloor: number | null;
    } | null,
  ) {
    if (!prefs) return 0;
    let score = 0;
    const title = job.title.toLowerCase();
    if (prefs.roleFamilies.some((f) => title.includes(f.toLowerCase()))) score += 25;
    if (
      job.location &&
      prefs.locations.some((l) =>
        job.location!.toLowerCase().includes(l.toLowerCase()),
      )
    ) {
      score += 15;
    }
    if (
      job.workMode &&
      prefs.workModes.some(
        (m) => m.toLowerCase() === job.workMode!.toLowerCase(),
      )
    ) {
      score += 15;
    }
    const pay = job.salaryMax ?? job.salaryMin;
    if (prefs.salaryFloor && pay && pay >= prefs.salaryFloor) score += 10;
    return score;
  }

  private async decorateListings<T extends { id: string }>(
    listings: T[],
    candidateId?: string,
  ) {
    if (!candidateId || listings.length === 0) {
      return listings.map((job) => ({
        ...job,
        matchPercent: null as number | null,
        relativeRankLabel: null as string | null,
        saved: false,
      }));
    }
    const ids = listings.map((j) => j.id);
    const [matches, saves] = await Promise.all([
      this.prisma.matchScore.findMany({
        where: { candidateId, jobListingId: { in: ids } },
      }),
      this.prisma.savedJob.findMany({
        where: { candidateId, jobListingId: { in: ids } },
        select: { jobListingId: true },
      }),
    ]);
    const matchByJob = new Map(matches.map((m) => [m.jobListingId, m]));
    const saved = new Set(saves.map((s) => s.jobListingId));
    return listings.map((job) => {
      const match = matchByJob.get(job.id);
      return {
        ...job,
        matchPercent: match?.matchPercent ?? null,
        relativeRankLabel: match?.relativeRankLabel ?? null,
        saved: saved.has(job.id),
      };
    });
  }

  async getById(id: string, candidateId?: string) {
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
    const [decorated] = await this.decorateListings([listing], candidateId);
    return decorated;
  }

  async save(candidateId: string, jobId: string) {
    const listing = await this.getById(jobId);
    return this.prisma.savedJob.upsert({
      where: {
        candidateId_jobListingId: {
          candidateId,
          jobListingId: listing.id,
        },
      },
      create: { candidateId, jobListingId: listing.id },
      update: {},
      include: { jobListing: true },
    });
  }

  async unsave(candidateId: string, jobId: string) {
    const listing = await this.getById(jobId);
    await this.prisma.savedJob.deleteMany({
      where: { candidateId, jobListingId: listing.id },
    });
    return { ok: true };
  }

  async listSaved(candidateId: string) {
    const rows = await this.prisma.savedJob.findMany({
      where: { candidateId },
      include: { jobListing: true },
      orderBy: { createdAt: 'desc' },
    });
    return this.decorateListings(
      rows.map((r) => ({ ...r.jobListing, savedAt: r.createdAt })),
      candidateId,
    );
  }
}
