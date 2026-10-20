FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY packages/domain packages/domain
COPY apps/api apps/api
COPY data data
RUN npm run build -w @sac-aisa/domain \
 && cd apps/api && npx prisma generate \
 && npm run build -w @sac-aisa/api

FROM node:22-alpine
WORKDIR /app
# postgresql-client: pg_dump para backups controlados pelo Admin do SAC
RUN apk add --no-cache openssl libc6-compat postgresql-client
ENV NODE_ENV=production
ENV BACKUP_DIR=/data/backups
RUN mkdir -p /data/backups
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 3001
# Aplica migrations + seed e sobe a API (sem resolve --rolled-back: gera P3012 se a migration não está failed)
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts && node dist/main.js"]
