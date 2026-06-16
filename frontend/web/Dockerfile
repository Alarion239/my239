# Build context is the frontend/ monorepo root so we can install the whole npm
# workspace (web + shared) in one shot. docker-compose sets context=./frontend,
# dockerfile=web/Dockerfile.

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

# Replace the default config with ours: SPA fallback + /api proxy to backend.
COPY web/nginx.conf /etc/nginx/conf.d/default.conf

# Copy the prebuilt static assets.
COPY --from=build /app/web/dist /usr/share/nginx/html

EXPOSE 80
