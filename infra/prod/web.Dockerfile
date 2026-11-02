# Caddy con la app del repartidor y el panel ya compilados (ADR-021). x86 y ARM.
# Contexto: la raíz del repositorio (ver .dockerignore: sin node_modules, mapas ni backend).

FROM node:22-alpine AS build
ARG API_URL
ARG APP_NAME=RouteControl
# Vite toma API_URL y APP_* del entorno al compilar (apps/*/vite.config.ts).
ENV API_URL=${API_URL} APP_NAME=${APP_NAME} CI=1
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile
RUN test -n "$API_URL" || (echo "Falta API_URL" && exit 1) \
    && pnpm --filter @routcontrol/driver build \
    && pnpm --filter @routcontrol/admin build

FROM caddy:2-alpine
COPY --from=build /src/apps/driver/dist /srv/app
COPY --from=build /src/apps/admin/dist /srv/panel
