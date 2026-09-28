# ---- Stage 1: build ----
FROM node:24-slim AS build
WORKDIR /app

# npm 11 dispara `node-gyp rebuild` implícitamente ante un binding.gyp sin
# script install: node-gyp exige python3+make para `configure`, pero su
# binding.gyp omite la compilación si existe prebuild del host. g++ se
# conserva como fallback si el prebuild no cubre la plataforma (p. ej. arm64).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Dependencias completas (mejor caché de capa si package.json no cambia)
COPY package.json package-lock.json ./
RUN npm ci

# Código fuente y compilación TypeScript → dist/
COPY tsconfig.json tsconfig.build.json tsconfig.scripts.json ./
COPY src/ src/
# Scripts de operador (CLI de promoción de admin). Se compilan aparte porque
# tsconfig.build.json fija rootDir=src e include=[src] — scripts/ nunca entraba en
# el build, así que la imagen no traía forma de crear el primer admin.
COPY scripts/ scripts/
# Migraciones (se aplican en el arranque; se copian al runtime desde este stage)
COPY migrations/ migrations/
RUN npm run build && npm run build:scripts

# ---- Stage 2: runtime ----
FROM node:24-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV DB_PATH=/app/data/app.sqlite

# npm dispara node-gyp también en `npm ci --omit=dev`, así que python3+make
# son necesarios aquí igual que en el build. Se purgan en la misma capa para
# que la imagen de runtime no arrastre toolchain.
COPY package.json package-lock.json ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && npm ci --omit=dev \
  && apt-get purge -y --auto-remove python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/dist ./dist
# CLI de operador compilada (promoteAdmin). Solo entra en la imagen el output de
# tsc: el runner de dist-scripts no necesita tsx ni las devDependencies, y sus
# únicos imports externos (better-sqlite3, drizzle-orm, zod) son de producción.
# Es la única vía de crear el primer admin sobre un despliegue real.
COPY --from=build /app/dist-scripts ./dist-scripts
# Las migraciones Drizzle se aplican automáticamente en el arranque (src/infra/compose.ts)
COPY --from=build /app/migrations ./migrations

# SQLite persistente. El chown no es decorativo: Docker crea el volumen
# nombrado heredando el owner de este punto de montaje, así el proceso
# no-root (USER node) puede escribir en él.
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data

EXPOSE 3000

# 404 = el router responde → proceso vivo. Sin wget/curl (no presentes en node:24-slim).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/nonexistent').then(r=>process.exit(r.status===404?0:1)).catch(()=>process.exit(1))"

# Proceso no-root: UID 1000 (usuario `node` de la imagen base). /app/data es
# el único punto de escritura y ya le pertenece (ver chown arriba).
USER node

CMD ["node", "dist/index.js"]
