# auth-api

[English](README.md) | [Español](README.es.md)

[![CI](https://github.com/dpa70-dev/auth-api/actions/workflows/ci.yml/badge.svg)](https://github.com/dpa70-dev/auth-api/actions/workflows/ci.yml)

API REST de registro y autenticación: email + contraseña, Google OIDC, magic link, OTP, cuentas de invitado, roles y moderación de usuarios. Construida con Clean Architecture, un contrato OpenAPI-first y 207 tests en verde.

El modelo de tokens y sesiones sigue las guías de transporte de OWASP: access JWT de vida corta más un refresh opaco con rotación y detección de reuso (revocación de toda la familia). Funciona desde cualquier cliente — SPA web, app móvil nativa o CLI.

## Por qué existe

Este proyecto es un servicio de autenticación completo y orientado a producción para cualquier aplicación que necesite registro/login sin recurrir a un proveedor externo. Está construido _spec-first_: el contrato OpenAPI se escribe antes que el código, el dominio jamás conoce Express, SQLite ni pino, y cada decisión de seguridad es deliberada y está documentada.

## Características

- **Múltiples métodos de acceso**: email + contraseña, Google (OIDC — verificación server-side contra JWKS con nonce anti-replay), magic link sin contraseña (canales login y reseteo) y OTP de 6 dígitos por email.
- **Cuentas de invitado**: sesiones anónimas temporales upgradables a identidad registrada (email + contraseña) sin perder la sesión.
- **Autorización y moderación**: roles `user` / `admin` con endpoints solo-admin, y un eje de estado de moderación (`active` / `suspended` / `banned`) que revoca todas las sesiones.
- **Seguridad de sesión**: refresh rotativo con revocación de familia por reuso, access de vida corta, cookie httpOnly para web y transporte por body para móvil.
- **Spec-Driven Development**: la especificación OpenAPI es la fuente de verdad y `src/api/contract.ts` se genera a partir de ella.

## Decisiones de seguridad

| Decisión | Por qué |
|---|---|
| Refresh opaco, guardado **hasheado (SHA-256)** en BD | Una filtración de la BD no expone tokens utilizables |
| **Rotación en cada refresh + detección de reuso** | Presentar un token ya usado revoca toda la familia del usuario |
| Access HS256 de 5–15 min, **algoritmo fijado en el servidor** | El servidor jamás confía en el header `alg` del JWT |
| **Anti-enumeración** en login, magic link y OTP | Respuestas idénticas y mismo trabajo realizado exista o no el email; hash ficticio verificado para igualar tiempos |
| Contraseñas con **argon2id** (parámetros OWASP m=19456, t=2, p=1) | Hashing de contraseñas de referencia |
| Política de credenciales **NIST 800-63B** (solo longitud 8–64) con criba de comprometidas | Sin reglas de complejidad arbitrarias; las contraseñas conocidas se rechazan |
| Rate limiting (global + específico de auth) con `Retry-After` | Mitigación de fuerza bruta en el borde |
| Env validado con Zod al arranque — falla rápido, sin `process.env` disperso | Una mala configuración no arranca en silencio |

## Arquitectura

**Clean Architecture** estricta; la flecha de dependencia siempre apunta hacia dentro:

```
               domain ← app ← infra / api
        (entidades, VOs,     (use cases)   (adaptadores, presentación)
         puertos, errores)
```

- `src/domain` — entidades, value objects brandeados (Zod 4, *parse, don't validate*) y puertos (interfaces). No importa nada externo.
- `src/app` — use cases. Dependen solo del dominio.
- `src/infra` — adaptadores: repositorios (Drizzle/SQLite), hasher (argon2id), emisor de tokens (jose), logger (pino), Unit of Work.
- `src/api` — rutas Express, handlers, middlewares y el contrato generado. Mapea los errores de dominio al envelope HTTP.
- **Ports & Adapters**: el hasher, el emisor de tokens y la base de datos son estrategias intercambiables — el dominio nunca importa una librería concreta. Los repositorios tienen un fake en memoria para tests y SQLite para producción.
- **Unit of Work** envuelve solo las escrituras: verificar / hashear / generar crypto ocurren *fuera* de la transacción.

```
Diagrama hexagonal:                      docs/09-arquitectura-hexagonal.svg
Circuito handlers → use cases:           docs/10-circuito-handlers-use-cases.svg
Dependencias por capas:                  docs/11-figura1-capas.svg
```

## Endpoints

Base: `/api/v1`. Envelope: éxito `{ "data": ... }`, error `{ "error": { code, message, details?, requestId } }`.

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/auth/register` | Registro local (email + contraseña) |
| POST | `/auth/login` | Inicio de sesión local |
| POST | `/auth/refresh` | Rotar el par de tokens |
| POST | `/auth/logout` | Revocar el refresh |
| POST | `/auth/google` | Entrar con Google (ID token OIDC) |
| GET | `/auth/me` | Perfil del usuario autenticado |
| POST | `/auth/magic-link/request` | Solicitar enlace sin contraseña (`intent: login` o `password_reset`) |
| POST | `/auth/magic-link/consume` | Canjear el enlace por sesión (auto-cuenta) |
| POST | `/auth/otp/request` | Solicitar código de 6 dígitos por email |
| POST | `/auth/otp/verify` | Verificar el código (auto-cuenta) |
| POST | `/auth/change-password` | Cambiar contraseña — revoca todas las sesiones |
| POST | `/auth/password/reset` | Reset vía enlace de recuperación (sin emitir sesión) |
| POST | `/auth/guest` | Crear sesión de invitado anónima |
| POST | `/auth/guest/upgrade` | Reclamar identidad en cuenta guest (conserva la sesión) |
| PATCH | `/admin/users/{id}/role` | Asignar rol `user`/`admin` (solo admin, sin auto-degradación) |
| PATCH | `/admin/users/{id}/status` | Asignar `active`/`suspended`/`banned` (revoca todas las sesiones) |

Contrato completo con ejemplos: `docs/03-openapi.yaml`.

## Inicio rápido

### Desarrollo local

```bash
cp .env.example .env
# JWT_SECRET es imperativa — genera una:
openssl rand -base64 48   # pega la salida en .env

npm install
npm run dev               # → http://localhost:3000/api/v1
```

Las migraciones Drizzle se aplican automáticamente al arrancar. El primer admin se bootstrapa con:

```bash
npm run promote:admin -- --email tu@ejemplo.com --role admin --dry-run
```

### Docker

```bash
export JWT_SECRET=$(openssl rand -base64 48)
docker compose up --build   # → http://localhost:3000/api/v1
```

El contenedor ejecuta las migraciones en el arranque y persiste SQLite en `/app/data` (volumen nombrado `api-data`, o bind mount local si usas el override que se explica abajo).

#### Bootstrap del primer admin en Docker

Los usuarios siempre nacen con rol `user`, así que el primer admin se promueve con la CLI de operador — el mismo script que `npm run promote:admin`, compilado dentro de la imagen para que no necesite ni `tsx` ni las devDependencies. Registra al fundador por la API primero y luego:

```bash
# inspeccionar sin escribir
docker compose exec api npm run promote:admin:dist -- --email tu@ejemplo.com --dry-run

# aplicar
docker compose exec api npm run promote:admin:dist -- --email tu@ejemplo.com
```

`--db-path` toma por defecto `$DB_PATH`, que la imagen fija en `/app/data/app.sqlite` — el mismo fichero que escribe el contenedor, así que no hace falta ningún argumento extra. Pasa `--db-path` explícitamente solo si vas a promover contra una base que esté fuera del contenedor. El rol se lee de la base en cada request (no viaja embebido en el JWT), así que `/admin/*` funciona en la llamada siguiente sin volver a autenticarse.

### Consultar la base de datos

SQLite es un único fichero, así que puedes inspeccionarla con cualquier cliente SQLite — DBeaver, `sqlite3`, un editor. **La ruta depende de cómo estés ejecutando la API**, y nunca debes abrir las dos a la vez: dos escritores sobre un mismo fichero SQLite producen `database is locked`.

| Cómo la ejecutas | Ruta que debes abrir |
|---|---|
| `npm run dev` (sin Docker) | `data/app.sqlite` |
| `docker compose up` | `data/docker/app.sqlite` |

El modo Docker usa el override local `docker-compose.override.yml`, que sustituye el volumen nombrado `api-data` por un bind mount a `./data/docker`. Ese archivo está en `.gitignore`: si clonaste el repo y no lo tienes, créalo con

```yaml
# docker-compose.override.yml
services:
  api:
    volumes:
      - ./data/docker:/app/data
```

y prepara el directorio con `mkdir -p data/docker`. Sin el override la base vive dentro de un volumen de Docker y ninguna herramienta externa puede abrirla.

Al conectar no hay host, puerto, usuario ni contraseña: en DBeaver elige el driver **SQLite** e indica solo la ruta absoluta del fichero.

## Scripts

| Comando | Descripción |
|---|---|
| `npm run dev` | Servidor de desarrollo (tsx watch) |
| `npm run build` | Compilar TypeScript a `dist/` |
| `npm run build:scripts` | Compilar las CLIs de operador a `dist-scripts/` (también dentro del build de Docker) |
| `npm start` | Ejecutar el build compilado |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` / `npm run test:watch` | Vitest |
| `npm run lint` | ESLint |
| `npm run contract` | Regenerar `src/api/contract.ts` desde la especificación OpenAPI |
| `npm run db:generate` / `db:migrate` | Drizzle kit |
| `npm run promote:admin` | Bootstrap del primer admin (local, vía `tsx`) |
| `npm run promote:admin:dist` | La misma CLI desde el output compilado — la forma de usarla dentro del contenedor |
| `npm run gen:password-list` | Generar la lista de hashes de contraseñas comprometidas |

## Configuración

Todas las variables de entorno se validan al arranque (Zod); el catálogo vive en `.env.example`.

| Variable | Default | Notas |
|---|---|---|
| `JWT_SECRET` | — | **Obligatoria** (≥ 32 caracteres, HS256) |
| `PORT` / `HOST` | `3000` / `localhost` | El contenedor usa `0.0.0.0` |
| `NODE_ENV` | `development` | `development` / `test` / `production` |
| `ACCESS_TTL_MINUTES` | `15` | 5–15 |
| `REFRESH_TTL_DAYS` | `30` | 7–30 |
| `GOOGLE_CLIENT_ID` | — | Opcional — habilita `/auth/google` |
| `DB_PATH` | `data/app.sqlite` | Archivo SQLite |
| `CORS_ORIGINS` | `http://localhost:5173` | Allowlist separada por comas |
| `RATE_LIMIT_*` | — | Ventanas/máximos global y de auth |
| `MAGIC_LINK_TTL_MINUTES` | `15` | Máx 60 |
| `OTP_TTL_MINUTES` | `5` | Máx 15 |
| `PUBLIC_API_ORIGIN` | dev `HOST:PORT` | Origin para los enlaces de email |
| `LOCAL_PASSWORD_LIST_PATH` | `data/top-100k-sha1.txt` | Archivo opcional de comprometidas |

## Testing

**207 tests en 26 archivos** (Vitest + Supertest contra un archivo SQLite temporal — nunca `:memory:`). La pirámide cubre value objects, use cases, rutas y flujos e2e completos.

```bash
npx tsc --noEmit
npx eslint src/ test/
npx vitest run
```

Estos tres gates corren automáticamente en CI (GitHub Actions, Node 24) — ver `.github/workflows/ci.yml`.

## Documentación

El registro de decisiones, el modelo de datos, la verificación de QA y los registros de arquitectura viven en `docs/`:

| Doc | Contenido |
|---|---|
| `00-consideraciones-tecnicas.md` | Decisiones técnicas (seguridad, transporte, hashing, rate limiting) |
| `01-historias-de-usuario.md` | Historias de usuario que guían el contrato (US-01 … US-16) |
| `02-flujos-registro-autenticacion.md` | Diagramas de flujos de autenticación |
| `03-openapi.yaml` | **El contrato** — OpenAPI 3.1 |
| `04-modelo-de-datos.md` | Modelo de datos y decisiones |
| `05-qa-verificacion-arquitectura.md` | Registro de QA, features y conteos de tests |
| `06-recomendaciones-transporte-multi-frontend.md` | Transporte de tokens para web / móvil / CLI |
| `09-arquitectura-hexagonal.md` | Arquitectura hexagonal |
| `13-patrones-a-sumarr.md` | Catálogo de patrones (outbox, domain events, circuit breaker…) |

## Licencia

[MIT](LICENSE) — Copyright (c) 2026 Daniel Pacheco.