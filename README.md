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
| `BETTER_AUTH_URL` | Public URL of this API (e.g. `http://localhost:4100` or Railway URL) |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Extra origins (comma-separated); `FRONTEND_URL` is always trusted |
| `B2B_API_URL` | B2B API base including `/v1` (apply bridge + internal jobs) |
| `B2B_SERVICE_TOKEN` | Service token for `/internal/*` |
| `RESEND_API_KEY` | Email OTP + lifecycle mail (optional in local; OTP logged if unset) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional Google OAuth |

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
