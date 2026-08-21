# Reerac Candidate API (B2C)

Separate NestJS backend + Postgres database for the candidate (talent) platform.

Auth and identity are **fully isolated** from the B2B recruiter API:

- Candidates authenticate with Better Auth on this service (cookies via the Next.js `/api/candidate-auth` proxy).
- Recruiters authenticate on the B2B backend only.
- Job applications: this API creates B2B applicants via `B2B_SERVICE_TOKEN` → `POST /internal/applications`.

## Setup

```bash
cp .env.example .env
# Set DATABASE_URL to a dedicated Postgres database
npm install
npx prisma db push
npm run start:dev
```

Default port: `4100`. Docs: `http://localhost:4100/docs`.

## Required env

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Dedicated Postgres |
| `FRONTEND_URL` | Shared Next app origin (CORS + Better Auth trusted origin) |
| `BETTER_AUTH_SECRET` | Better Auth secret |
| `BETTER_AUTH_URL` | **Browser-facing Next origin** (e.g. `https://reerac.ng` or `http://localhost:3000`) — not the Railway API host |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Extra origins (comma-separated); `FRONTEND_URL` is always trusted |
| `B2B_API_URL` | B2B API base including `/v1` (apply bridge + internal jobs) |
| `B2B_SERVICE_TOKEN` | Service token for `/internal/*` |
| `B2B_DATABASE_URL` | B2B Postgres (migration script only — read applicants + backfill) |
| `RESEND_API_KEY` | Email OTP + lifecycle mail |
| `RESEND_FROM_EMAIL` | Verified sender, e.g. `Reerac AI <no-reply@notifications.reerac.ng>` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional Google OAuth |

### Google OAuth (candidate)

Candidate Better Auth uses **basePath** `/api/candidate-auth` (proxied by Next). In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → your OAuth **Web client**, add these **Authorized redirect URIs** (exact match):

```text
https://www.reerac.ng/api/candidate-auth/callback/google
http://localhost:3000/api/candidate-auth/callback/google
```

Also keep the recruiter (B2B) URI if you share the same client:

```text
https://www.reerac.ng/api/auth/callback/google
http://localhost:3000/api/auth/callback/google
```

**Authorized JavaScript origins:**

```text
https://www.reerac.ng
https://reerac.ng
http://localhost:3000
```

On Railway **candidate-api**, set:

```env
FRONTEND_URL=https://www.reerac.ng
BETTER_AUTH_URL=https://www.reerac.ng
```

`BETTER_AUTH_URL` must be the **browser Next origin** (not the Railway API host). A wrong value produces Google `Error 400: redirect_uri_mismatch`.

## Frontend (reerac-ai)

Candidate UI lives in [`reerac-ai`](../reerac-ai) under `/candidate/*` and shared `/login?account=candidate` / `/signup?account=candidate`.

Set:

```bash
NEXT_PUBLIC_CANDIDATE_API_URL=https://<candidate-api-host>/v1
# Optional server-only override for Next rewrites:
CANDIDATE_API_URL=https://<candidate-api-host>/v1
```

Next.js rewrites (same-origin cookies):

- `/api/candidate-auth/*` → candidate-api `/api/auth/*`
- `/api/candidate/*` → candidate-api `/v1/*`

## Railway deploy

1. New service from `candidate-api/` (Dockerfile + `start.sh`).
2. Attach a **separate** Postgres plugin (`DATABASE_URL`).
3. Set env vars above; point `FRONTEND_URL` at the production Next origin.
4. Point `B2B_API_URL` / `B2B_SERVICE_TOKEN` at the B2B Railway service (apply + job sync only — not for login).
5. Set frontend `NEXT_PUBLIC_CANDIDATE_API_URL` / `CANDIDATE_API_URL` to this service’s public URL + `/v1`.

## Auth endpoints

- Better Auth: `/api/auth/*` (sign-up/sign-in email, session, Google)
- OTP: `POST /v1/auth/send-otp`, `POST /v1/auth/verify-otp`
- Profile: `GET/PATCH /v1/me` (cookie session)

## Integration with B2B

- Jobs: `B2B_API_URL` + `B2B_SERVICE_TOKEN` → `/internal/jobs`
- Applications: → `/internal/applications`
- Events: Redis stream `reerac:b2b:events` (optional)

## Shadow candidates and B2B migration

Talent who applied (or had a legacy B2B `CANDIDATE` user) before B2C signup are stored as **SHADOW** candidates (`authUserId` null). On signup, `ensureCandidate` claims the row by email → `ACTIVE`.

### Schema

```bash
npx prisma db push
# or migrate deploy after reviewing SQL
```

If `db push` fails on `@@unique([email])`, dedupe first:

```sql
SELECT lower(email) AS e, count(*) FROM candidates GROUP BY 1 HAVING count(*) > 1;
```

### Run migration (idempotent)

1. Set `DATABASE_URL` (candidate-api) and `B2B_DATABASE_URL` (B2B Postgres; needs read on applicants/users/jobs/companies and **update** on `applicants.externalCandidateId`).
2. Dry-run:

```bash
npm run migrate:b2b-candidates:dry
```

3. Apply:

```bash
npm run migrate:b2b-candidates
```

### Post-migration checks

```sql
-- candidate-api
SELECT "accountStatus", count(*) FROM candidates GROUP BY 1;
SELECT count(*) FROM applications WHERE "b2bApplicantId" IS NOT NULL;

-- B2B
SELECT count(*) FROM applicants WHERE "externalCandidateId" IS NOT NULL AND "deletedAt" IS NULL;
```

Manual claim test: pick a SHADOW email that has applications → sign up at `/signup?account=candidate` with that email → row becomes `ACTIVE` with same `id` and applications retained.
