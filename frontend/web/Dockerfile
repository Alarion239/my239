# ---- build stage ----
FROM node:20-alpine AS build

WORKDIR /app

# Install deps first so the layer is cached when only source changes.
COPY package.json ./
RUN npm install --no-audit --no-fund

# Bring in the rest of the source and build the static bundle.
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

# ---- runtime stage ----
FROM nginx:1.27-alpine

# Replace the default config with ours: SPA fallback + /api proxy to backend.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the prebuilt static assets.
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
