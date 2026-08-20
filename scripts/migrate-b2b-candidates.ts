/**
 * One-time (idempotent) migration: B2B applicants + legacy CANDIDATE users
 * → candidate-api SHADOW Candidate rows + Application links + B2B externalCandidateId backfill.
 *
 * Usage:
 *   B2B_DATABASE_URL=... DATABASE_URL=... npx tsx scripts/migrate-b2b-candidates.ts --dry-run
 *   B2B_DATABASE_URL=... DATABASE_URL=... npx tsx scripts/migrate-b2b-candidates.ts
 *
 * Or add both URLs to candidate-api/.env and run:
 *   npm run migrate:b2b-candidates:dry
 *
 * Requires schema with optional authUserId, accountStatus, unique email (prisma db push).
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient, Prisma, type CandidateApplicationStatus } from '@prisma/client';

/** Load KEY=VALUE pairs from .env into process.env (does not override existing). */
function loadDotEnv(file = resolve(process.cwd(), '.env')) {
  if (!existsSync(file)) return;
  const text = readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

function cleanDbUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let v = raw.trim();
  // cmd `set VAR="url"` keeps the quotes in the value
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v || undefined;
}

type B2bApplicantRow = {
  id: string;
  jobId: string;
  companyId: string;
  externalCandidateId: string | null;
  name: string;
  email: string;
  phone: string | null;
  portfolioUrl: string | null;
  coverLetter: string | null;
  cvUrl: string;
  cvFileName: string;
  status: string;
  cvScanStatus: string;
  appliedAt: Date;
  deletedAt: Date | null;
};

type B2bJobRow = {
  id: string;
  title: string;
  department: string;
  location: string;
  workMode: string;
  type: string;
  salaryMin: number;
  salaryMax: number;
  currency: string;
  description: string;
  requirements: string[];
  responsibilities: string[];
  status: string;
  closingDate: Date;
  hiringCompanyName: string | null;
  companyName: string | null;
};

type B2bCandidateUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
};

type Identity = {
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  applicants: B2bApplicantRow[];
};

const dryRun = process.argv.includes('--dry-run');

function mapB2bStatus(
  status: string,
  cvScanStatus?: string,
): CandidateApplicationStatus {
  if (cvScanStatus === 'SCANNING') return 'SCREENING';
  switch (status) {
    case 'NEW':
      return 'IN_REVIEW';
    case 'INTERVIEW_SCHEDULED':
      return 'IN_PROCESS';
    case 'INTERVIEW_COMPLETE':
      return 'INTERVIEWED';
    case 'SHORTLISTED':
      return 'SHORTLISTED';
    case 'HIRED':
      return 'HIRED';
    case 'REJECTED':
      return 'NOT_SELECTED';
    default:
      return 'APPLIED';
  }
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || 'Candidate',
    lastName: parts.slice(1).join(' ') || '',
  };
}

function richness(a: B2bApplicantRow): number {
  let n = 0;
  if (a.phone?.trim()) n += 2;
  if (a.portfolioUrl?.trim()) n += 1;
  if (a.coverLetter?.trim()) n += 1;
  if (a.cvUrl?.trim()) n += 2;
  if (a.name?.trim()) n += 1;
  return n;
}

function pickBestApplicant(
  rows: B2bApplicantRow[],
): B2bApplicantRow | undefined {
  if (!rows.length) return undefined;
  return [...rows].sort((a, b) => {
    const r = richness(b) - richness(a);
    if (r !== 0) return r;
    return b.appliedAt.getTime() - a.appliedAt.getTime();
  })[0];
}

async function main() {
  const b2bUrl = cleanDbUrl(process.env.B2B_DATABASE_URL);
  const candidateUrl = cleanDbUrl(process.env.DATABASE_URL);

  if (!b2bUrl) {
    throw new Error('Set B2B_DATABASE_URL (B2B Postgres connection string)');
  }
  if (!candidateUrl) {
    throw new Error('Set DATABASE_URL (candidate-api Postgres connection string)');
  }
  if (
    !candidateUrl.startsWith('postgresql://') &&
    !candidateUrl.startsWith('postgres://')
  ) {
    throw new Error(
      `DATABASE_URL must start with postgresql:// (got: ${candidateUrl.slice(0, 24)}…). In cmd.exe do not wrap with quotes when using set, or rely on .env only.`,
    );
  }

  const b2b = new PrismaClient({
    datasources: { db: { url: b2bUrl } },
  });
  const db = new PrismaClient({
    datasources: { db: { url: candidateUrl } },
  });

  const stats = {
    emails: 0,
    candidatesCreated: 0,
    candidatesSkipped: 0,
    candidatesClaimedExisting: 0,
    jobListingsUpserted: 0,
    applicationsCreated: 0,
    applicationsSkipped: 0,
    backfilled: 0,
  };

  try {
    console.log(
      dryRun
        ? '=== DRY RUN (no writes) ==='
        : '=== APPLYING MIGRATION ===',
    );

    const applicants = await b2b.$queryRaw<B2bApplicantRow[]>`
      SELECT
        a.id,
        a."jobId",
        a."companyId",
        a."externalCandidateId",
        a.name,
        a.email,
        a.phone,
        a."portfolioUrl",
        a."coverLetter",
        a."cvUrl",
        a."cvFileName",
        a.status::text AS status,
        a."cvScanStatus"::text AS "cvScanStatus",
        a."appliedAt",
        a."deletedAt"
      FROM applicants a
      WHERE a."deletedAt" IS NULL
        AND a."anonymizedAt" IS NULL
    `;

    const candidateUsers = await b2b.$queryRaw<B2bCandidateUser[]>`
      SELECT id, email, "firstName", "lastName", phone
      FROM users
      WHERE role = 'CANDIDATE'
    `;

    const byEmail = new Map<string, Identity>();

    for (const a of applicants) {
      const email = String(a.email || '')
        .toLowerCase()
        .trim();
      if (!email || !email.includes('@')) continue;
      let entry = byEmail.get(email);
      if (!entry) {
        const { firstName, lastName } = splitName(a.name);
        entry = {
          email,
          firstName,
          lastName,
          phone: a.phone,
          applicants: [],
        };
        byEmail.set(email, entry);
      }
      entry.applicants.push(a);
    }

    for (const u of candidateUsers) {
      const email = String(u.email || '')
        .toLowerCase()
        .trim();
      if (!email || !email.includes('@')) continue;
      let entry = byEmail.get(email);
      if (!entry) {
        entry = {
          email,
          firstName: u.firstName || 'Candidate',
          lastName: u.lastName || '',
          phone: u.phone,
          applicants: [],
        };
        byEmail.set(email, entry);
      } else {
        if ((!entry.firstName || entry.firstName === 'Candidate') && u.firstName) {
          entry.firstName = u.firstName;
        }
        if (!entry.lastName && u.lastName) entry.lastName = u.lastName;
        if (!entry.phone && u.phone) entry.phone = u.phone;
      }
    }

    // Prefer richest applicant for name/phone
    for (const entry of byEmail.values()) {
      const best = pickBestApplicant(entry.applicants);
      if (best) {
        const { firstName, lastName } = splitName(best.name);
        entry.firstName = firstName;
        entry.lastName = lastName;
        if (best.phone?.trim()) entry.phone = best.phone.trim();
      }
    }

    stats.emails = byEmail.size;
    console.log(
      `Found ${applicants.length} applicants, ${candidateUsers.length} CANDIDATE users → ${byEmail.size} unique emails`,
    );

    const jobIds = [
      ...new Set(
        [...byEmail.values()].flatMap((e) =>
          e.applicants.map((a) => a.jobId),
        ),
      ),
    ];

    console.log(`Loading ${jobIds.length} jobs from B2B…`);
    const jobsById = new Map<string, B2bJobRow>();
    if (jobIds.length) {
      const jobs = await b2b.$queryRaw<B2bJobRow[]>`
        SELECT
          j.id,
          j.title,
          j.department,
          j.location,
          j."workMode"::text AS "workMode",
          j.type::text AS type,
          j."salaryMin",
          j."salaryMax",
          j.currency,
          j.description,
          j.requirements,
          j.responsibilities,
          j.status::text AS status,
          j."closingDate",
          j."hiringCompanyName",
          c.name AS "companyName"
        FROM jobs j
        LEFT JOIN companies c ON c.id = j."companyId"
        WHERE j.id IN (${Prisma.join(jobIds)})
      `;
      for (const j of jobs) jobsById.set(j.id, j);
    }
    console.log(`Loaded ${jobsById.size} jobs`);

    // Upsert job listings once (not per application)
    if (!dryRun) {
      console.log('Upserting job listings into candidate-api…');
      let ji = 0;
      for (const job of jobsById.values()) {
        ji += 1;
        const companyName =
          job.hiringCompanyName?.trim() ||
          job.companyName?.trim() ||
          'Hiring company';
        await db.jobListing.upsert({
          where: { b2bJobId: job.id },
          create: {
            id: job.id,
            b2bJobId: job.id,
            companyName,
            title: job.title,
            department: job.department,
            location: job.location,
            workMode: job.workMode,
            type: job.type,
            salaryMin: job.salaryMin,
            salaryMax: job.salaryMax,
            currency: job.currency || 'NGN',
            description: job.description || '',
            requirements: job.requirements || [],
            responsibilities: job.responsibilities || [],
            status: job.status || 'ACTIVE',
            closingDate: job.closingDate,
            syncedAt: new Date(),
          },
          update: {
            companyName,
            title: job.title,
            status: job.status || 'ACTIVE',
            syncedAt: new Date(),
          },
        });
        stats.jobListingsUpserted += 1;
        if (ji % 25 === 0 || ji === jobsById.size) {
          console.log(`  jobs ${ji}/${jobsById.size}`);
        }
      }
    }

    const identities = [...byEmail.values()];
    console.log(`Migrating ${identities.length} candidates…`);

    for (let i = 0; i < identities.length; i++) {
      const identity = identities[i]!;
      if ((i + 1) % 10 === 0 || i === 0 || i + 1 === identities.length) {
        console.log(
          `  candidates ${i + 1}/${identities.length} (created=${stats.candidatesCreated}, apps=${stats.applicationsCreated})`,
        );
      }

      let candidate = await db.candidate.findUnique({
        where: { email: identity.email },
      });

      if (!candidate) {
        if (dryRun) {
          stats.candidatesCreated += 1;
        } else {
          candidate = await db.candidate.create({
            data: {
              email: identity.email,
              firstName: identity.firstName,
              lastName: identity.lastName,
              phone: identity.phone,
              authUserId: null,
              accountStatus: 'SHADOW',
              source: 'MIGRATION_B2B',
              migratedAt: new Date(),
              profile: { create: {} },
            },
          });
          stats.candidatesCreated += 1;
        }
      } else {
        stats.candidatesSkipped += 1;
        if (
          !dryRun &&
          candidate.accountStatus === 'SHADOW' &&
          !candidate.phone &&
          identity.phone
        ) {
          candidate = await db.candidate.update({
            where: { id: candidate.id },
            data: { phone: identity.phone },
          });
        }
        if (candidate.authUserId) {
          stats.candidatesClaimedExisting += 1;
        }
      }

      const candidateId = candidate?.id;
      if (!candidateId && dryRun) {
        stats.applicationsCreated += identity.applicants.length;
        continue;
      }
      if (!candidateId) continue;

      const best = pickBestApplicant(identity.applicants);
      if (best?.cvUrl && !dryRun) {
        const existingCv = await db.cvAsset.findFirst({
          where: { candidateId, url: best.cvUrl },
        });
        if (!existingCv) {
          await db.cvAsset.create({
            data: {
              candidateId,
              url: best.cvUrl,
              fileName: best.cvFileName || 'cv.pdf',
              isPrimary: true,
            },
          });
        }
      }

      for (const app of identity.applicants) {
        const job = jobsById.get(app.jobId);
        if (!job) {
          console.warn(`Missing B2B job ${app.jobId} for applicant ${app.id}`);
          continue;
        }

        if (!dryRun) {
          const existingApp = await db.application.findFirst({
            where: {
              OR: [
                { b2bApplicantId: app.id },
                {
                  candidateId,
                  jobListingId: job.id,
                },
              ],
            },
          });

          if (existingApp) {
            if (!existingApp.b2bApplicantId) {
              await db.application.update({
                where: { id: existingApp.id },
                data: { b2bApplicantId: app.id },
              });
            }
            stats.applicationsSkipped += 1;
          } else {
            await db.application.create({
              data: {
                candidateId,
                jobListingId: job.id,
                b2bApplicantId: app.id,
                status: mapB2bStatus(app.status, app.cvScanStatus),
                appliedAt: app.appliedAt,
                lastSyncedAt: new Date(),
              },
            });
            stats.applicationsCreated += 1;
          }

          if (!app.externalCandidateId) {
            await b2b.$executeRaw`
              UPDATE applicants
              SET "externalCandidateId" = ${candidateId}
              WHERE id = ${app.id}
                AND "externalCandidateId" IS NULL
            `;
            stats.backfilled += 1;
          } else if (app.externalCandidateId !== candidateId) {
            console.warn(
              `Applicant ${app.id} already linked to ${app.externalCandidateId}, local candidate ${candidateId}`,
            );
          }
        } else {
          stats.applicationsCreated += 1;
          if (!app.externalCandidateId) stats.backfilled += 1;
        }
      }
    }

    console.log('\nDone.', stats);
  } finally {
    await b2b.$disconnect();
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
