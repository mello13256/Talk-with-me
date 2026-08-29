# syntax=docker/dockerfile:1

# ---- build ------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

COPY . .
RUN npm run build

# Drop dev dependencies from the layer that gets copied into the runtime image.
RUN npm prune --omit=dev

# ---- runtime ----------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

RUN apk add --no-cache tini wget

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist

# Only needed with STORAGE_DRIVER=local; mount a volume here to persist uploads.
RUN mkdir -p /app/storage && chown -R node:node /app/storage
USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1

# tini reaps zombies and forwards SIGTERM so shutdown stays graceful.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/dist/index.js"]
