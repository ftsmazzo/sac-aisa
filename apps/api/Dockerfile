FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json ./
COPY packages/domain/package.json packages/domain/
COPY apps/api/package.json apps/api/
RUN npm install --workspace=@sac-aisa/domain --workspace=@sac-aisa/api

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/domain/node_modules ./packages/domain/node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY package.json ./
COPY packages/domain packages/domain
COPY apps/api apps/api
COPY data data
RUN npm run build -w @sac-aisa/domain \
 && cd apps/api && npx prisma generate \
 && npm run build -w @sac-aisa/api

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts && node dist/main.js"]
