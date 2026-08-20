# ─── Build Stage ───
FROM node:20-slim AS builder

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma/
# Dummy URL so prisma generate passes validation during build
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate

COPY . .
RUN rm -f tsconfig.build.tsbuildinfo \
  && npm run build \
  && test -f dist/main.js

# ─── Production Stage ───
FROM node:20-slim AS runner

RUN apt-get update -y && apt-get install -y openssl libstdc++6 ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/start.sh ./start.sh
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

RUN chmod +x start.sh

EXPOSE ${PORT:-4100}

CMD ["sh", "-c", "npx prisma db push --skip-generate --accept-data-loss && ./start.sh"]
