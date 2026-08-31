import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { B2bClientService } from '../b2b/b2b-client.service.js';
import { jobMatchesRole } from '../matching/role-match.js';
import { normalizeWorkMode, workModesMatch } from '../matching/work-mode.js';
import { startOfTodayLagos } from '../lib/lagos-date.js';

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
  private lastCatalogSyncAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly b2b: B2bClientService,
  ) {}

  async syncFromB2b() {
    try {
      let page = 1;
      let synced = 0;
      for (;;) {
        const result = await this.b2b.listActiveJobs({ limit: 100, page });
        const jobs = result.data ?? [];
        for (const job of jobs) {
          await this.upsertListing(job);
        }
        synced += jobs.length;
        const totalPages = Number(result.meta?.totalPages ?? 1);
        if (!jobs.length || page >= totalPages || page >= 20) break;
        page += 1;
      }
      this.logger.log(`Synced ${synced} jobs from B2B`);
      return { synced };
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
    await this.syncCatalogIfStale();
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 20, 100);
    const today = startOfTodayLagos();
    const where: Prisma.JobListingWhereInput = {
      status: { in: ['ACTIVE', 'active', 'PAUSED', 'paused'] },
    };
    const and: Prisma.JobListingWhereInput[] = [
      {
        OR: [{ closingDate: null }, { closingDate: { gte: today } }],
      },
    ];
    if (params.search) {
      and.push({
        OR: [
          { title: { contains: params.search, mode: 'insensitive' } },
          { department: { contains: params.search, mode: 'insensitive' } },
          { location: { contains: params.search, mode: 'insensitive' } },
          { companyName: { contains: params.search, mode: 'insensitive' } },
        ],
      });
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
    if (params.workMode) {
      const wanted = normalizeWorkMode(params.workMode);
      if (wanted) {
        rows = rows.filter((job) => normalizeWorkMode(job.workMode) === wanted);
      }
    }
    if (params.minMatch != null && params.candidateId) {
      rows = rows.filter((j) => (j.matchPercent ?? 0) >= params.minMatch!);
    }

    if (params.forYou && params.candidateId) {
      const prefs = await this.prisma.candidateJobPreference.findUnique({
        where: { candidateId: params.candidateId },
      });
      if (prefs) {
        rows = this.applyPreferences(rows, prefs);
      }
      rows = rows
        .map((job) => ({
          ...job,
          forYouScore:
            this.preferenceScore(job, prefs) + (job.matchPercent ?? 40),
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
      department?: string | null;
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
      nyscOrEntry?: boolean;
    } | null,
  ) {
    if (!prefs) return 0;
    let score = 0;
    if (prefs.roleFamilies.some((f) => jobMatchesRole(job, f))) score += 25;
    if (
      job.location &&
      prefs.locations.some((l) =>
        job.location!.toLowerCase().includes(l.toLowerCase()),
      )
    ) {
      score += 15;
    }
    if (workModesMatch(job.workMode, prefs.workModes)) {
      score += 15;
    }
    const pay = job.salaryMax ?? job.salaryMin;
    if (prefs.salaryFloor && pay && pay >= prefs.salaryFloor) score += 10;
    if (prefs.nyscOrEntry && isEntryLevelJob(job.title)) score += 10;
    return score;
  }

  private async syncCatalogIfStale() {
    const now = Date.now();
    if (now - this.lastCatalogSyncAt < 60_000) return;
    this.lastCatalogSyncAt = now;
    try {
      await this.syncFromB2b();
    } catch (err) {
      this.logger.warn(
        `Catalog sync skipped: ${(err as Error).message}`,
      );
    }
  }

  private applyPreferences<
    T extends {
      title: string;
      department?: string | null;
      location?: string | null;
      workMode?: string | null;
      salaryMin?: number | null;
      salaryMax?: number | null;
    },
  >(
    rows: T[],
    prefs: {
      roleFamilies: string[];
      locations: string[];
      workModes: string[];
      salaryFloor: number | null;
      nyscOrEntry: boolean;
    },
  ) {
    let next = rows;
    if (prefs.roleFamilies.length) {
      next = next.filter((job) => this.matchesRolePreference(job, prefs));
    }
    const refined = next.filter((job) =>
      this.matchesSecondaryPreferences(job, prefs),
    );
    return refined.length ? refined : next;
  }

  private matchesRolePreference(
    job: {
      title: string;
      department?: string | null;
    },
    prefs: { roleFamilies: string[]; nyscOrEntry: boolean },
  ) {
    if (!prefs.roleFamilies.length) return true;
    if (prefs.roleFamilies.some((family) => jobMatchesRole(job, family))) {
      return true;
    }
    return prefs.nyscOrEntry && isEntryLevelJob(job.title);
  }

  private matchesSecondaryPreferences(
    job: {
      location?: string | null;
      workMode?: string | null;
      salaryMin?: number | null;
      salaryMax?: number | null;
    },
    prefs: {
      locations: string[];
      workModes: string[];
      salaryFloor: number | null;
    },
  ) {
    if (prefs.locations.length && job.location) {
      const loc = job.location.toLowerCase();
      const locOk = prefs.locations.some((item) => {
        const wanted = item.toLowerCase();
        return loc.includes(wanted) || wanted.includes(loc);
      });
      if (!locOk) return false;
    }
    if (prefs.workModes.length && !workModesMatch(job.workMode, prefs.workModes)) {
      return false;
    }
    const pay = job.salaryMax ?? job.salaryMin;
    if (prefs.salaryFloor != null && pay != null && pay < prefs.salaryFloor) {
      return false;
    }
    return true;
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
        applied: false,
        applicationId: null as string | null,
      }));
    }
    const ids = listings.map((j) => j.id);
    const [matches, saves, apps] = await Promise.all([
      this.prisma.matchScore.findMany({
        where: { candidateId, jobListingId: { in: ids } },
      }),
      this.prisma.savedJob.findMany({
        where: { candidateId, jobListingId: { in: ids } },
        select: { jobListingId: true },
      }),
      this.prisma.application
        .findMany({
          where: { candidateId, jobListingId: { in: ids } },
          select: { id: true, jobListingId: true },
        })
        .catch(() => [] as Array<{ id: string; jobListingId: string }>),
    ]);
    const matchByJob = new Map(matches.map((m) => [m.jobListingId, m]));
    const saved = new Set(saves.map((s) => s.jobListingId));
    const appByJob = new Map(apps.map((a) => [a.jobListingId, a.id]));
    return listings.map((job) => {
      const match = matchByJob.get(job.id);
      return {
        ...job,
        matchPercent: match?.matchPercent ?? null,
        relativeRankLabel: match?.relativeRankLabel ?? null,
        saved: saved.has(job.id),
        applied: appByJob.has(job.id),
        applicationId: appByJob.get(job.id) ?? null,
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

function isEntryLevelJob(title?: string | null) {
  const hay = (title ?? "").toLowerCase();
  return /nysc|intern|graduate|entry|junior|trainee|corper/.test(hay);
}
