# Reerac Candidate API (B2C)

Separate NestJS backend + Postgres database for the candidate platform (PRD v2).

## Setup

```bash
cp .env.example .env
# Set DATABASE_URL to a dedicated Postgres database
npm install
npx prisma db push
npm run start:dev
```

Default port: `4100`. Docs: `http://localhost:4100/docs`.

## Frontend

Candidate UI lives in the shared Next app [`reerac-ai`](../reerac-ai) under `/candidate/*` (not a separate frontend). Set `FRONTEND_URL=http://localhost:3000` and trusted origins accordingly.

## Integration with B2B

- Sync: `B2B_API_URL` + `B2B_SERVICE_TOKEN` call `/internal/jobs` and `/internal/applications`.
- Events: consumes Redis stream `reerac:b2b:events`.
