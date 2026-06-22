# Build context is the frontend/ monorepo root so we can install the whole npm
# workspace (web + shared) in one shot. This Dockerfile lives at the frontend/
# root so it is auto-detected as the builder (Docker Compose sets
# context=./frontend; Railway uses Root Directory=/frontend). COPY paths below
# are relative to that context, so the web/ and shared/ workspaces resolve.

# ---- build stage ----
FROM node:20-alpine AS build

WORKDIR /app

# Bring in the workspace root and each workspace's package.json first so the
# npm install layer is cached when only source changes.
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY web/package.json ./web/
RUN npm install --no-audit --no-fund

# Now the actual sources. shared/ is referenced from web/ via the
# @my239/shared workspace package, so Vite resolves it through the symlink npm
# install just created.
COPY shared ./shared
COPY web ./web

WORKDIR /app/web
RUN npm run build

# ---- runtime stage ----
FROM nginx:1.27-alpine

# Opt into the image's 15-local-resolvers.envsh: it reads the container's DNS
# server from /etc/resolv.conf into ${NGINX_LOCAL_RESOLVERS}, which the template
# uses for its `resolver` directive. This makes the backend reverse-proxy work
# with zero resolver config in both Docker Compose (127.0.0.11) and on Railway
# (the internal IPv6 DNS) — only BACKEND_HOST/BACKEND_PORT must be supplied.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
# Default listen port for Compose; Railway overrides PORT and routes its public
# domain to it, so the same image works without setting a target port by hand.
ENV PORT=80

# Our config is a template: the nginx image's entrypoint runs envsubst on
# /etc/nginx/templates/*.template at start, writing /etc/nginx/conf.d/default.conf.
# The backend host/port come from env so the same image runs in Docker Compose
# and on Railway. SPA fallback + /api proxy + SSE passthrough.
COPY web/nginx.conf.template /etc/nginx/templates/default.conf.template

# Copy the prebuilt static assets.
COPY --from=build /app/web/dist /usr/share/nginx/html

EXPOSE 80
