# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- build stage
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
# .env files are excluded by .dockerignore on purpose: nothing environment
# specific is baked into the bundle. Firebase & co. are injected at runtime.
RUN npm run build

# --------------------------------------------------------------- runtime stage
FROM nginx:stable-alpine

# Defaults – override with -e / env_file / compose `environment:`
ENV PORT=8080 \
    FRAME_ANCESTORS="*" \
    NGINX_ENVSUBST_FILTER="^(PORT|FRAME_ANCESTORS)$"

# nginx config is rendered from templates at start (official image feature)
COPY docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY docker/app-headers.inc.template /etc/nginx/templates/app-headers.inc.template
# writes /usr/share/nginx/html/config.js from VITE_* env vars at start
COPY --chmod=755 docker/40-app-config.sh /docker-entrypoint.d/40-app-config.sh

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1
