FROM node:22-bookworm-slim AS base
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM base AS production-deps
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN npm ci --omit=dev && npx prisma generate

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-deps --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=production-deps --chown=node:node /app/prisma ./prisma
COPY --chown=node:node prisma/migrations ./prisma/migrations
COPY --chown=node:node scripts ./scripts
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
