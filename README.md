# auth-api

[English](README.md) | [Español](README.es.md)

[![CI](https://github.com/dpa70-dev/auth-api/actions/workflows/ci.yml/badge.svg)](https://github.com/dpa70-dev/auth-api/actions/workflows/ci.yml)

REST API for signup/login authentication: email + password, Google OIDC, magic link, OTP, guest accounts, roles and user moderation. Built with Clean Architecture, an OpenAPI-first contract, and 207+ passing tests.

The token/session model follows transport guidelines from OWASP: short-lived access JWT plus a rotating opaque refresh token with reuse detection (family revocation). It works from any client — web SPA, native mobile or CLI.

## Why this exists

This project is a complete, production-oriented authentication service for any application that needs signup/login without reaching for a third-party provider. It is built _spec-first_: the OpenAPI contract is written before the code, the domain never knows about Express, SQLite or pino, and every security decision is deliberate and documented.

## Features

- **Multiple sign-in methods**: email + password, Google (OIDC — server-side JWKS verification with nonce anti-replay), passwordless magic link (login and password-reset channels) and 6-digit OTP by email.
- **Guest accounts**: anonymous temporary sessions upgradable to a registered identity (email + password) without losing the session.
- **Authorization and moderation**: `user` / `admin` roles with admin-only endpoints, and a moderation status axis (`active` / `suspended` / `banned`) that revokes all sessions.
- **Session security**: rotating refresh tokens with family revocation on reuse, short-lived access tokens, httpOnly cookie transport for web and body transport for mobile.
- **Spec-Driven Development**: the OpenAPI spec is the source of truth and `src/api/contract.ts` is generated from it.

## Security highlights

| Decision | Why |
|---|---|
| Refresh token opaque, stored **hashed (SHA-256)** in DB | A DB leak does not expose usable tokens |
| **Rotation on every refresh + reuse detection** | Presenting an already-used token revokes the whole token family |
| Access token HS256, 5–15 min, **algorithm fixed server-side** | The server never trusts the `alg` header from the JWT |
| **Anti-enumeration** in login, magic link and OTP | Identical responses and identical work whether the email exists or not; a dummy hash is verified to equalize timing |
| Passwords hashed with **argon2id** (OWASP parameters m=19456, t=2, p=1) | State-of-the-art password hashing |
| Credential policy per **NIST 800-63B** (length-only 8–64) with compromised-password screening | No arbitrary complexity rules; known-passwords are rejected |
| Rate limiting (global + auth-specific) with `Retry-After` | Brute-force mitigation at the edge |
| Env validated with Zod at boot — fails fast, no scattered `process.env` | Misconfiguration cannot start silently |

## Architecture

Strict **Clean Architecture**; the dependency arrow always points inward:

```
               domain ← app ← infra / api
        (entities, VOs,     (use cases)   (adapters, presentación)
         ports, errores)
```

- `src/domain` — entities, branded value objects (Zod 4, *parse, don't validate*) and ports (interfaces). Imports nothing external.
- `src/app` — use cases. Depends only on the domain.
- `src/infra` — adapters: repositories (Drizzle/SQLite), password hasher (argon2id), token issuer (jose), logger (pino), Unit of Work.
- `src/api` — Express routes, handlers, middlewares and the generated contract. Maps domain errors to the HTTP envelope.
- **Ports & Adapters**: the hasher, the token issuer and the database are interchangeable strategies — the domain never imports a concrete library. The repositories are backed by an in-memory fake for tests and SQLite for production.
- **Unit of Work** wraps only the writes: verify / hash / generate-crypto happen *outside* the transaction.

```
Clean Architecture / hexagonal diagram:  docs/09-arquitectura-hexagonal.svg
Handlers → use cases circuit:            docs/10-circuito-handlers-use-cases.svg
Layer dependencies:                      docs/11-figura1-capas.svg
```

## Endpoints

Base path: `/api/v1`. Envelope: success `{ "data": ... }`, error `{ "error": { code, message, details?, requestId } }`.

| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Local signup (email + password) |
| POST | `/auth/login` | Local login |
| POST | `/auth/refresh` | Rotate the token pair |
| POST | `/auth/logout` | Revoke the refresh token |
| POST | `/auth/google` | Sign in with Google (OIDC ID token) |
| GET | `/auth/me` | Authenticated user profile |
| POST | `/auth/magic-link/request` | Request a passwordless link (`intent: login` or `password_reset`) |
| POST | `/auth/magic-link/consume` | Exchange the link for a session (auto-account) |
| POST | `/auth/otp/request` | Request a 6-digit code by email |
| POST | `/auth/otp/verify` | Verify the code (auto-account) |
| POST | `/auth/change-password` | Change password — revokes all sessions |
| POST | `/auth/password/reset` | Reset via the password-reset link (no session issued) |
| POST | `/auth/guest` | Create an anonymous guest session |
| POST | `/auth/guest/upgrade` | Claim identity on a guest account (keeps the session) |
| PATCH | `/admin/users/{id}/role` | Set `user`/`admin` role (admin only, cannot self-demote) |
| PATCH | `/admin/users/{id}/status` | Set `active`/`suspended`/`banned` (revokes all sessions) |

Full contract with examples: `docs/03-openapi.yaml`.

## Quick start

### Local development

```bash
cp .env.example .env
# JWT_SECRET is imperative — generate one:
openssl rand -base64 48   # paste the output into .env

npm install
npm run dev               # → http://localhost:3000/api/v1
```

Drizzle migrations run automatically at boot. The first admin is bootstrapped with:

```bash
npm run promote:admin -- --email you@example.com --role admin --dry-run
```

### Docker

```bash
export JWT_SECRET=$(openssl rand -base64 48)
docker compose up --build   # → http://localhost:3000/api/v1
```

The container runs migrations at startup and persists SQLite in `/app/data` (the `api-data` named volume, or a local bind mount if you use the override described below).

#### Bootstrapping the first admin in Docker

Users are always created with the `user` role, so the first admin is promoted with the operator CLI — the same script as `npm run promote:admin`, compiled into the image so it needs neither `tsx` nor the dev dependencies. Register the founder through the API first, then:

```bash
# inspect without writing
docker compose exec api npm run promote:admin:dist -- --email you@example.com --dry-run

# apply
docker compose exec api npm run promote:admin:dist -- --email you@example.com
```

`--db-path` defaults to `$DB_PATH`, which the image sets to `/app/data/app.sqlite` — the same file the container writes, so no extra argument is needed. Pass `--db-path` explicitly only when promoting against a database outside the container. The role is read from the database on every request (it is not embedded in the JWT), so `/admin/*` works on the next call without re-authenticating.

### Inspecting the database

SQLite is a single file, so you can inspect it with any SQLite client — DBeaver, `sqlite3`, an editor. **The path depends on how you are running the API**, and you should never open both at once: two writers on the same SQLite file produce `database is locked`.

| How you run it | Path to open |
|---|---|
| `npm run dev` (no Docker) | `data/app.sqlite` |
| `docker compose up` | `data/docker/app.sqlite` |

Docker mode uses the local override `docker-compose.override.yml`, which replaces the `api-data` named volume with a bind mount to `./data/docker`. That file is in `.gitignore`: if you cloned the repo and do not have it, create it with

```yaml
# docker-compose.override.yml
services:
  api:
    volumes:
      - ./data/docker:/app/data
```

and prepare the directory with `mkdir -p data/docker`. Without the override the database lives inside a Docker volume and no external tool can open it.

When connecting there is no host, port, user or password: in DBeaver pick the **SQLite** driver and give only the absolute path to the file.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Dev server (tsx watch) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run build:scripts` | Compile the operator CLIs to `dist-scripts/` (also run inside the Docker build) |
| `npm start` | Run the compiled build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` / `npm run test:watch` | Vitest |
| `npm run lint` | ESLint |
| `npm run contract` | Regenerate `src/api/contract.ts` from the OpenAPI spec |
| `npm run db:generate` / `db:migrate` | Drizzle kit |
| `npm run promote:admin` | Bootstrap the first admin (local, via `tsx`) |
| `npm run promote:admin:dist` | Same CLI from the compiled output — the form to use inside the container |
| `npm run gen:password-list` | Generate the compromised-passwords hash list |

## Configuration

All environment variables are validated at boot (Zod); the catalog lives in `.env.example`.

| Variable | Default | Notes |
|---|---|---|
| `JWT_SECRET` | — | **Required** (≥ 32 chars, HS256) |
| `PORT` / `HOST` | `3000` / `localhost` | Container sets `0.0.0.0` |
| `NODE_ENV` | `development` | `development` / `test` / `production` |
| `ACCESS_TTL_MINUTES` | `15` | 5–15 |
| `REFRESH_TTL_DAYS` | `30` | 7–30 |
| `GOOGLE_CLIENT_ID` | — | Optional — enables `/auth/google` |
| `DB_PATH` | `data/app.sqlite` | SQLite file |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowlist |
| `RATE_LIMIT_*` | — | Global and auth windows/max |
| `MAGIC_LINK_TTL_MINUTES` | `15` | Max 60 |
| `OTP_TTL_MINUTES` | `5` | Max 15 |
| `PUBLIC_API_ORIGIN` | dev `HOST:PORT` | Origin for email links |
| `LOCAL_PASSWORD_LIST_PATH` | `data/top-100k-sha1.txt` | Optional compromised-passwords file |

## Testing

**207 tests in 26 files** (Vitest + Supertest against a temporary SQLite file — never `:memory:`). The pyramid covers value objects, use cases, routes and full end-to-end flows.

```bash
npx tsc --noEmit
npx eslint src/ test/
npx vitest run
```

These three gates run automatically in CI (GitHub Actions, Node 24) — see `.github/workflows/ci.yml`.

## Documentation

The decision log, data model, QA verification and architecture records live in `docs/`:

| Doc | Content |
|---|---|
| `00-consideraciones-tecnicas.md` | Technical decisions (security, transport, hashing, rate limiting) |
| `01-historias-de-usuario.md` | User stories driving the contract (US-01 … US-16) |
| `02-flujos-registro-autenticacion.md` | Auth flow diagrams |
| `03-openapi.yaml` | **The contract** — OpenAPI 3.1 |
| `04-modelo-de-datos.md` | Data model and decisions |
| `05-qa-verificacion-arquitectura.md` | QA log, feature records and test counts |
| `06-recomendaciones-transporte-multi-frontend.md` | Token transport for web / mobile / CLI |
| `09-arquitectura-hexagonal.md` | Hexagonal architecture |
| `13-patrones-a-sumarr.md` | Design-pattern catalog (outbox, domain events, circuit breaker…) |

## License

[MIT](LICENSE) — Copyright (c) 2026 Daniel Pacheco.