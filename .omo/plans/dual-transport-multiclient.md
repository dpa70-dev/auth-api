# dual-transport-multiclient - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**What you'll get:** La API emite la sesión por el cuerpo de la respuesta (para apps móviles) y ADEMÁS guarda el refresh en una cookie de solo servidor (para la web). Al renovar sesión o salir, acepta la cookie o el cuerpo; cada login crea una familia de refrescos independiente; el logout borra la cookie.

**Why this approach:** El documento docs/06 manda: el access token viaja SOLO por el header de autorización (memoria de la SPA), y el refresh llega por cookie httpOnly en web o por el cuerpo en móvil. Para no detectar el tipo de cliente, emitimos ambas vías siempre y el servidor prioriza la cookie al recibir.

**What it will NOT do:** No guarda el access token en cookie, no acepta el refresh por header, no intenta adivinar si el cliente es web o móvil, no revoca todas las sesiones de golpe, y no añade CSRF tokens (SameSite + tipo de contenido bastan).

**Effort:** Medium
**Risk:** Medium - cambio en el transporte de la sesión + eliminación de una clave foránea en la base de datos
**Decisions to sanity-check:** Se quita la FK `family_id → users` (la familia deja de ser un usuario y pasa a ser una sesión); el campo `refreshToken` del cuerpo pasa a OPCIONAL; CORS pasa a `credentials: true`.

Your next move: approve and start execution (start-work), or run a high-accuracy review (momus + oracle) — this is a security-sensitive session-transport change. Full execution detail follows below.

---

> TL;DR (machine): Medium effort | Medium risk | transporte dual del refresh (cookie web / body móvil), access Bearer-only, family_id UUID por sesión (+drop FK), contract+docs, e2e de cookies

## Scope
### Must have
- Access token: ÚNICA fuente `Authorization: Bearer` en `requireAuth` — se REVIERTE el fallback de cookie `access_token` del cambio previo (docs/06 §3.1).
- Emisión dual del refresh (sin detectar cliente): register, login, google, magic-link-consume y refresh devuelven el par `{ accessToken, refreshToken }` en el body (móvil intacto) Y setean `Set-Cookie: refresh_token=<r>; HttpOnly; Secure[prod]; SameSite=Lax; Path=/api/v1/auth; Max-Age=<refreshTtl>` (web).
- Recepción dual del refresh: `/auth/refresh` y `/auth/logout` leen la cookie primero, el body después; `refreshToken` en el body pasa a OPCIONAL; sin ninguna fuente → `401 UNAUTHORIZED` genérico. Logout limpia la cookie.
- `cookie-parser` (dependencia + tipos) montado en `src/index.ts`; CORS `credentials: true` con la allowlist estricta existente.
- `family_id` = `randomUUID()` por sesión: cada login/google/magic/register crea una familia; la rotación hereda el `familyId` presentado; el reuso revoca SOLO esa familia. **Requiere eliminar la FK `refresh_tokens.family_id → users.id`** (migración; la app aplica migraciones en boot via `compose.ts:55`).
- Contrato y docs actualizados: `docs/03-openapi.yaml` (cookieAuth + refreshToken opcional) → `npm run contract`; `docs/00` ítem 39; `docs/04` decisión 2 + FK; `docs/06` §2.3/§3.
- Suites e2e nuevas para el camino cookie + regresión completa (93 tests existentes intactos).

### Must NOT have (guardrails, anti-slop, scope boundaries)
- Access token emitido o leído desde cookie (ni `Set-Cookie access_token` ni `ACCESS_TOKEN_COOKIE`).
- Refresh token por `Authorization: Bearer` (anti-patrón docs/06 §2.2).
- Detección de tipo de cliente (User-Agent, headers) para decidir transporte.
- Tokens CSRF / librerías anti-CSRF (SameSite=Lax + `Content-Type: application/json` exigido por `express.json`).
- Auto-linking de cuentas Google/local, `logoutAll`, tabla de sesiones nueva.
- Migración más allá del drop de la FK de `family_id`; `family_id` no se hace nullable; la FK de `user_id` no se toca.
- `as any` / `@ts-ignore` / `@ts-expect-error`.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: tests-after (los 93 tests e2e existentes son la red de regresión) + suite de cookies dedicada (T11). Sin framework nuevo.
- Evidence: `<attemptDir>/task-<N>-dual-transport-multiclient.<ext>` (attemptDir = currentAttemptDir from 'omo ulw-loop status --json', `.omo/evidence/ulw/<session>/<goalId>/a<attempt>`; outside ulw-loop use `.omo/evidence/`).

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.

- **Wave 1 — infra y dominio (sin cambio de comportamiento):** T1 (deps + cookie-parser + CORS), T2 (revert Bearer-only), T3 (helpers de cookie), T4 (VO familyId), T5 (schema: drop FK + migración). Todos paralelos.
- **Wave 2 — aplicación y transporte:** T6 (repositorio: FamilyId), T7 (issueSession + use cases: familia por sesión), T8 (schemas opcional + handlers Set-Cookie/lectura cookie→body). T6→T7; T8 paralelo a T6/T7.
- **Wave 3 — cierre:** T9 (OpenAPI + contract), T10 (docs 00/04/06), T11 (suite e2e de cookies). Todos paralelos entre sí.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| T1 | — | T3 (runtime), T8 | T2, T3, T4, T5 |
| T2 | — | T11 | T1, T3, T4, T5 |
| T3 | — | T8 | T1, T2, T4, T5 |
| T4 | — | T6, T7 | T1, T2, T3, T5 |
| T5 | — | T7, T11 | T1, T2, T3, T4 |
| T6 | T4 | T7, T11 | T8 |
| T7 | T4, T5, T6 | T11 | T8 |
| T8 | T1, T3 | T9, T10, T11 | T6, T7 |
| T9 | T8 | T10 (semántica), F-wave | T10, T11 |
| T10 | T8, T9 | F-wave | T9, T11 |
| T11 | T2, T5, T6, T7, T8 | F-wave | T9, T10 |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [ ] 1. `package.json` + `src/index.ts`: instalar `cookie-parser` (+ `@types/cookie-parser`), montarlo y activar CORS `credentials: true`
  What to do / Must NOT do: `npm i cookie-parser` y `npm i -D @types/cookie-parser`. En `src/index.ts`: `import cookieParser from 'cookie-parser';`, `app.use(cookieParser());` DESPUÉS de `express.json({ limit: '16kb' })` y ANTES del mount de rutas `app.use(API_PREFIX, apiRouter(...))`; CORS: `app.use(cors({ origin: config.corsOrigins, credentials: true }))`. Must NOT: reordenar helmet/express.json/pinoHttp; `origin: *` ni `origin: true`; tocar rutas o handlers.
  Parallelization: Wave 1 | Blocked by: — | Blocks: T3 (en runtime), T8
  References (executor has NO interview context - be exhaustive): `package.json` L23-36 (deps) y L37-51 (devDeps); `src/index.ts` L20-40 (orden de middlewares: helmet → cors L27 → pinoHttp → requestId → express.json → apiRouter L35); `src/config.ts` (tipo `Config`, `corsOrigins`, `API_PREFIX` L6). Scripts: `npm run typecheck` (= tsc --noEmit), `npm run lint` (= eslint .), `npm test` (= vitest run).
  Acceptance criteria (agent-executable): `npm run typecheck` exit 0; grep en `src/index.ts` muestra `cookieParser()` y `credentials: true`; `npm test` = 93/93 verdes (sin cambio de comportamiento).
  QA scenarios (name the exact tool + invocation): happy: `npm test` (US-04 logout sigue 204, US-03 refresh sigue 200 por body); failure: `npm run typecheck` con el import mal ubicado. Evidence `.omo/evidence/task-1-dual-transport-multiclient.txt`.
  Commit: Y | `build(deps): add cookie-parser + types` y `feat(http): mount cookie parser, CORS credentials true`

- [ ] 2. `src/api/middlewares/authMiddleware.ts`: revertir a Bearer-only (quitar el fallback de cookie `access_token`)
  What to do / Must NOT do: Eliminar `resolveAccessToken`, `accessTokenFromCookie`, `ACCESS_TOKEN_COOKIE` y el import de tipo `Request`; `requireAuth` vuelve a resolver el access EXCLUSIVAMENTE de `req.headers.authorization` con prefijo `Bearer ` (cortar con `slice(prefix.length)`). ACTUALIZAR TAMBIÉN el JSDoc de `requireAuth` (L15-20): hoy dice «o, si el header está ausente, de la cookie 'access_token' (fallback...)» — eliminar ese fragmento (→ «El token sale del header Authorization (Bearer), única fuente»). Must NOT: usar `git revert` (el cambio previo ya convive con otras líneas — edición manual); reintroducir cualquier lectura de cookie para el access; tocar el resto del middleware (strategy/verifier).
  Parallelization: Wave 1 | Blocked by: — | Blocks: T11
  References (executor has NO interview context - be exhaustive): `src/api/middlewares/authMiddleware.ts` (estado actual con los 3 helpers de cookie); `test/e2e.test.ts` L257-284 (GET /auth/me: 401 idéntico sin token/malformado/aleatorio — debe seguir pasando); `docs/00-consideraciones-tecnicas.md` ítem 39 (Bearer-only); `docs/06` §3.1.
  Acceptance criteria (agent-executable): `npm run typecheck` exit 0; grep en `authMiddleware.ts` NO muestra `cookie` ni `ACCESS_TOKEN_COOKIE`; `npm test` verde (tests US-05 L257-284).
  QA scenarios: happy: `npm test -t "US-05"`; failure: `GET /auth/me` enviando `Cookie: access_token=<jwt valido>` SIN header Authorization → esperar 401 idéntico al sin-token (assert añadido en T11). Evidence `.omo/evidence/task-2-dual-transport-multiclient.txt`.
  Commit: Y | `revert(api): access token solo por Authorization Bearer (sin fallback cookie)(docs/06 §3.1)`

- [ ] 3. `src/api/cookies.ts` (NUEVO): helpers de cookie de sesión (refresh)
  What to do / Must NOT do: Crear el módulo con `export const REFRESH_COOKIE = 'refresh_token';` y 3 funciones tipadas con `Request`/`Response` y `Config`: `setRefreshCookie(res, refreshToken, config)` → `res.cookie(REFRESH_COOKIE, refreshToken, { httpOnly: true, secure: config.nodeEnv === 'production', sameSite: 'lax', path: `${API_PREFIX}/auth`, maxAge: config.refreshTtlDays * 24 * 60 * 60 * 1000 })`; `clearRefreshCookie(res, config)` → `res.clearCookie(REFRESH_COOKIE, { ...mismas options sin maxAge })`; `readRefreshCookie(req)` → `req.cookies?.[REFRESH_COOKIE]` (retorna `string | undefined`). Must NOT: cookies firmadas (`signedCookies`); helper de access; duplicar el nombre de la cookie fuera de este módulo.
  Parallelization: Wave 1 | Blocked by: — | Blocks: T8
  References (executor has NO interview context - be exhaustive): `src/config.ts` `API_PREFIX` L6, tipo `Config` (campos `nodeEnv`, `refreshTtlDays`); `src/index.ts` L35 (todas las rutas auth cuelgan de `API_PREFIX`); types de Express 5 (`res.cookie`, `res.clearCookie` — maxAge en ms) y `@types/cookie-parser` (augmenta `Express.Request.cookies`); `docs/06` §3.2 (HttpOnly, Secure, SameSite=Lax, Path elegible).
  Acceptance criteria (agent-executable): `npm run typecheck` exit 0; el módulo exporta `REFRESH_COOKIE`, `setRefreshCookie`, `clearRefreshCookie`, `readRefreshCookie`.
  QA scenarios: happy: smoke con un `res` fake (spy de `cookie`) verificando options (httpOnly true, sameSite 'lax', path '/api/v1/auth', maxAge = refreshTtlDays*86400000); failure: `readRefreshCookie` sin cookies → `undefined` (sin throw). Evidence `.omo/evidence/task-3-dual-transport-multiclient.txt`.
  Commit: Y | `feat(api): cookie helpers para refresh token (docs/06 §3.2)`

- [ ] 4. `src/domain/vo/familyId.ts` (NUEVO) + barrel `src/domain/vo/index.ts`: VO `FamilyId`
  What to do / Must NOT do: Crear `familyIdSchema = z.uuid({ message: 'invalid_family_id' })` y `export type FamilyId = z.infer<typeof familyIdSchema>;` — espejo EXACTO de `jti.ts`; añadir la exportación al barrel `index.ts` (orden de imports, camino `.js`). Must NOT: validación manual/regex; exponer el VO fuera del dominio (los handler NO validan familyId — decisión server-side).
  Parallelization: Wave 1 | Blocked by: — | Blocks: T6, T7
  References (executor has NO interview context - be exhaustive): `src/domain/vo/jti.ts` (plantilla de 6 líneas); `src/domain/vo/index.ts` (barrel — formato de exports); `docs/04` decisión 2 (family_id como UUID de sesión) y `docs/00` ítem 38.
  Acceptance criteria (agent-executable): `npm run typecheck` y `npm run lint` exit 0; `FamilyId` y `familyIdSchema` exportados desde `src/domain/vo/index.js`.
  QA scenarios: happy: `familyIdSchema.parse(randomUUID())` pasa y tipa como `FamilyId`; failure: `familyIdSchema.parse('no-uuid')` lanza el mensaje `invalid_family_id`. Evidence `.omo/evidence/task-4-dual-transport-multiclient.txt`.
  Commit: Y | `feat(domain): VO familyId (z.uuid) — familia = sesión`

- [ ] 5. `src/db/schema.ts` + migración: eliminar la FK `family_id → users.id`
  What to do / Must NOT do: En la tabla `refreshTokens`, quitar SOLO la línea `foreignKey({ columns: [t.familyId], foreignColumns: [users.id] }).onDelete('cascade'),` (debajo de la FK de userId). Conservar columna `family_id`, `userId` FK y el índice `idx_refresh_tokens_family_id`. Luego `npm run db:generate` y `npm run db:migrate`; REVISAR la migración `migrations/0003_*.sql` generada (SQLite = rebuild de tabla: create temporal → copia → drop → rename; debe contener SOLO el drop de esa FK). Must NOT: `family_id` nullable; tocar la FK de `user_id`; borrar la columna; crear tabla `sessions`; editar snapshots previos de `migrations/meta/`.
  Parallelization: Wave 1 | Blocked by: — | Blocks: T7, T11
  References (executor has NO interview context - be exhaustive): `src/db/schema.ts` L74-79 (bloque de FKs — L79 es la de familyId); `drizzle.config.ts` (dialect sqlite, `out: './migrations'`, `DB_PATH` default `data/app.sqlite`); `src/infra/compose.ts` L55 (`migrate(db, { migrationsFolder: './migrations' })` — corre en boot, incluido en tests con `:memory:`); `migrations/` 0000-0002 + `meta/`; `docs/04` L69/L74/L89 (columnas, FK, índice).
  Acceptance criteria (agent-executable): `npm run db:generate` exit 0 y el SQL de `migrations/0003_*.sql` dropa la FK de familyId (sin otros cambios de columnas); `npm test` 93/93 (migrate sobre `:memory:` aplica 0003).
  QA scenarios: happy: `PRAGMA foreign_key_list(refresh_tokens);` (sqlite3 o consulta en un test) ya no lista family_id; failure: insertar refresh con `familyId = randomUUID()` (tras T7) NO viola FK → cubierto por T11. Evidence `.omo/evidence/task-5-dual-transport-multiclient.txt`.
  Commit: Y | `fix(db): family_id sin FK a users (la familia es una sesión)`

- [ ] 6. `src/domain/port/userRepository.ts` + `src/infra/drizzleUserRepository.ts`: `revokeFamily` y `InsertRefreshToken` con `FamilyId`
  What to do / Must NOT do: En el puerto: `InsertRefreshToken.familyId: FamilyId` (en vez de `UserId`) y `revokeFamily(familyId: FamilyId)` con JSDoc «revoca TODA la familia de refresh del sessionId». En drizzle: `revokeFamily(familyId: FamilyId)` → `eq(refreshTokens.familyId, familyId)` (la columna ya existe; solo cambia el tipo/param). Must NOT: tocar SQL de inserción, delete-cascade de userId, ni otros métodos del puerto.
  Parallelization: Wave 2 | Blocked by: T4 | Blocks: T7, T11
  References (executor has NO interview context - be exhaustive): `src/domain/port/userRepository.ts` (`InsertRefreshToken` — campo `familyId` hoy tipado `UserId`, `revokeFamily` hoy con userId); `src/infra/drizzleUserRepository.ts` (impl de `revokeFamily`); `src/domain/vo/familyId.ts` (T4); test de regresión `test/e2e.test.ts` L207-241 (US-03: reuso revoca la familia completa).
  Acceptance criteria (agent-executable): `npm run typecheck` exit 0; `npm test` verde (US-03 L207-241 revoca por `family_id`).
  QA scenarios: happy: `npm test -t "US-03"` (reuso → 401 y el NUEVO de la misma familia muere); failure: reuso con famlias distintas (nuevo test de T11) NO se afectan. Evidence `.omo/evidence/task-6-dual-transport-multiclient.txt`.
  Commit: Y | `refactor(domain): revokeFamily y InsertRefreshToken adoptan FamilyId`

- [ ] 7. `src/app/helpers/issueSession.ts` + use cases: `familyId` = `randomUUID()` por sesión + herencia en rotación
  What to do / Must NOT do: `IssueSessionInput` gana `familyId: FamilyId` y `insertRefreshToken({ ..., familyId: input.familyId })` (hoy usa `input.userId` — `src/app/helpers/issueSession.ts:27`). En los 4 emisores — `src/app/useCases/login.ts`, `registerUser.ts`, `loginGoogle.ts`, `consumeMagicLink.ts` — pasar `familyId: familyIdSchema.parse(randomUUID())`. IMPORTANTE (verificado): de los 4, SOLO `registerUser.ts` (L1), `loginGoogle.ts` (L1) y `consumeMagicLink.ts` (L1) importan `randomUUID` de `node:crypto`; **`login.ts` NO lo importa — hay que AÑADIR `import { randomUUID } from 'node:crypto';`** (además de importar `familyIdSchema` en los 4 desde `../../domain/vo/index.js`). En `src/app/useCases/refreshTokens.ts`: en rotación `issueSession({ familyId: found.familyId, ... })` (el registro `found` ya incluye `familyId` — `src/infra/drizzleUserRepository.ts:95` lo mapea) y en reuso `revokeFamily(found.familyId)` (hoy `found.userId` en L39). Must NOT: `familyId = userId`; reutilizar un familyId entre sesiones distintas; exponer `familyId` en el body (decisión server-side).
  Parallelization: Wave 2 | Blocked by: T4, T5, T6 | Blocks: T11
  References (executor has NO interview context - be exhaustive): `src/app/helpers/issueSession.ts` (L27 `familyId: input.userId`; `IssueSessionInput`); `src/app/useCases/login.ts`; `src/app/useCases/registerUser.ts` (L1 ya importa `randomUUID`); `src/app/useCases/loginGoogle.ts` y `consumeMagicLink.ts` (ya importan `randomUUID`); `src/app/useCases/refreshTokens.ts` (rotación + L39 `revokeFamily(found.userId)`); `docs/06` §5 (family_id por sesión); `test/e2e.test.ts` L207-241 (reuso → toda la familia muere: las rotaciones heredan familyId).
  Acceptance criteria (agent-executable): `npm run typecheck` y `npm test` verdes — US-03 completo (L207-241) pasa porque la rotación hereda el familyId presentado.
  QA scenarios: happy: `npm test -t "US-03"`; failure: INDEPENDENCIA (T11, caso 7): 2 sesiones del mismo usuario → reuso de la 1ª NO mata la 2ª. Evidence `.omo/evidence/task-7-dual-transport-multiclient.txt`.
  Commit: Y | `feat(app): familia por sesión (randomUUID por login, herencia en rotación)`

- [ ] 8. `src/api/handlers/schemas.ts` + `authHandlers.ts` + `magicLinkHandlers.ts`: `refreshToken` opcional + emisión Set-Cookie y lectura cookie→body
  What to do / Must NOT do: En `schemas.ts`, `refreshRequest.refreshToken` pasa a `.optional()` (conservar `.min(1)` cuando viene). En `authHandlers.ts`: register, login, google y refresh → `setRefreshCookie(res, result.refreshToken, deps.config)` INMEDIATAMENTE ANTES de `writeSuccess` (regla: body SIEMPRE lleva el par + cookie siempre); en refresh y logout, la resolución es cookie PRIMERO y body después con MANEJO DE BODY AUSENTE: `const fromCookie = readRefreshCookie(req); const parsed = refreshRequest.safeParse(req.body ?? {}); const presented = fromCookie ?? (parsed.success ? parsed.data.refreshToken : undefined);` y si `!presented` → `throw ApiError` 401 `UNAUTHORIZED` (mismo código genérico que token inválido). OJO (verificado): `refreshRequest.parse(undefined)` (request SIN body ni Content-Type JSON, `req.body === undefined` en Express 5) lanzaría un ZodError 400 — por eso usar `safeParse(req.body ?? {})`, nunca parse directo, para preservar el 401 genérico (anti-enumeración). En refresh, setear la cookie con el refresh NUEVO (rotación); en logout, `clearRefreshCookie(res, deps.config)` + 204. En `magicLinkHandlers.ts`, `magicLinkConsumeHandler` → `setRefreshCookie` antes de `writeSuccess`. Must NOT: leer access desde cookie; Bearer para refresh; cookie en `/auth/me` ni change-password; tocar `writeSuccess`/envelope; debilitar el 401 genérico (anti-enumeración L269-284); parse directo de `req.body` en refresh/logout.
  Parallelization: Wave 2 | Blocked by: T1, T3 | Blocks: T9, T10, T11
  References (executor has NO interview context - be exhaustive): `src/api/handlers/schemas.ts` (L12 `refreshRequest` — compartido por refresh y logout); `src/api/handlers/authHandlers.ts` (`buildAuthHandlers`, handlers register/login/refresh/logout/google — lectura de `deps.config`); `src/api/handlers/magicLinkHandlers.ts` L30-41 (`magicLinkConsumeHandler` recibe `refreshTtlDays`); `src/api/cookies.ts` (T3); `src/api/protocol/success.ts` L15 (`writeSuccess`); `src/api/deps.ts` (`ApiDeps = { tokens, config }`); `docs/06` §3.2/§3.3 (cookie primero); `test/e2e.test.ts` L208-254 (refresh y logout por body — deben seguir passando con el campo opcional).
  Acceptance criteria (agent-executable): `npm run typecheck` + `npm run lint` exit 0; `npm test` 93/93 (refresh/logout por body intactos).
  QA scenarios: happy: `npm test -t "US-03"` y `-t "US-04"`; failure: refresh sin body y sin cookie → 401 UNAUTHORIZED (caso T11-5). Evidence `.omo/evidence/task-8-dual-transport-multiclient.txt`.
  Commit: Y | `feat(api): emisión Set-Cookie y lectura cookie→body del refresh (docs/06 §3)`

- [ ] 9. `docs/03-openapi.yaml` + `npm run contract`: `cookieAuth` y `refreshToken` opcional
  What to do / Must NOT do: Añadir a `securitySchemes` un esquema `cookieAuth` (type `apiKey`, `in: cookie`, `name: refresh_token`); en las operaciones refresh y logout: `refreshToken` del body pasa a `required: false` y `security: [{ cookieAuth: [] }]` con una nota de la prioridad cookie→body y del `Set-Cookie` de respuesta. Ejecutar `npm run contract` (regenera `src/contract.ts`) y REVISAR el diff. Must NOT: tocar `bearerAuth` ni el security de me/changePassword; cambiar esquemas de login/register.
  Parallelization: Wave 3 | Blocked by: T8 | Blocks: T10 (semántica), F-wave
  References (executor has NO interview context - be exhaustive): `docs/03-openapi.yaml` L574-578 (securitySchemes con `bearerAuth`); operaciones `/auth/refresh` y `/auth/logout` del mismo archivo; `src/contract.ts` (hoy `cookie?: never` en refresh/logout — debe dejar de ser `never` tras regenerar); script `contract` en `package.json` (openapi-typescript docs/03-openapi.yaml -o src/contract.ts).
  Acceptance criteria (agent-executable): `npm run contract` exit 0; diff de `src/contract.ts`: en los tipos de refresh/logout el campo cookie ya NO es `never` y `refreshToken` queda opcional.
  QA scenarios: happy: `npm run contract` y grep `cookie` en `src/contract.ts`; failure: `openapi-typescript` sin cambios si se olvida el yaml → el diff saldría vacío (detectar y corregir el yaml antes). Evidence `.omo/evidence/task-9-dual-transport-multiclient.txt`.
  Commit: Y | `docs(contract): cookieAuth y refreshToken opcional en refresh/logout`

- [ ] 10. `docs/00-consideraciones-tecnicas.md`, `docs/04-modelo-de-datos.md`, `docs/06-recomendaciones-transporte-multi-frontend.md`: reflejar lo implementado
  What to do / Must NOT do: docs/00 ítem 39: access Bearer-only (implementado), refresh dual cookie/body con cookie-parser, CORS `credentials: true`, CSRF mitigado por SameSite=Lax + Content-Type JSON. docs/04: L69 y L74 (family_id = UUID de sesión, SIN FK a users), L100 (`revokeFamily` por family_id), L128 y L153 (decisión 2: familia = sesión), L168 (sesiones = refresh activos por family_id). docs/06: §2.3 y §3 → estado «implementado» (con nº de ítem/commit si el repo lo usa), §3.3 nota de la prioridad cookie→body. Must NOT: inventar decisiones/fechas; reescribir secciones ajenas; tocar otras decisiones del doc 04 (la FK de user_id sigue).
  Parallelization: Wave 3 | Blocked by: T8, T9 | Blocks: F-wave
  References (executor has NO interview context - be exhaustive): `docs/00-consideraciones-tecnicas.md` ítem 39; `docs/04-modelo-de-datos.md` L29 (`family_id "familia de rotación"`), L69, L74 (FK), L89 (índice), L100, L127-128, L153, L168; `docs/06-recomendaciones-transporte-multi-frontend.md` §2.3, §3.1/§3.2/§3.3, §5.
  Acceptance criteria (agent-executable): grep `family_id = user_id` en docs/04 → 0 coincidencias; ítem 39 y §3 de docs/06 marcados como implementados.
  QA scenarios: happy: grep los fragmentos citados y confirmar redacción; failure: si queda `= user_id` o «pendiente» → revisar contra el código real (T7/T5). Evidence `.omo/evidence/task-10-dual-transport-multiclient.txt`.
  Commit: Y | `docs: transporte dual (cookie web / body móvil) y familia por sesión`

- [ ] 11. `test/e2e.test.ts`: suite e2e del transporte por cookie (7 casos) + regresión completa
  What to do / Must NOT do: Añadir describe «Transversal — transporte por cookie (docs/06 §3)» REUSANDO los helpers existentes (`post`, `get`, `startApp`, `readJson`, `AuthData`): (1) register/login → `res.headers.getSetCookie()` contiene `refresh_token=` con `HttpOnly`, `SameSite=Lax`, `Path=/api/v1/auth` Y body con ambos tokens; (2) refresh SOLO con cookie (sin body) → 200 con par nuevo; (3) prioridad de cookie: cookie válida + body con token inválido → 200; (4) logout con cookie → 204 + `Set-Cookie` que expira (Max-Age=0/expires pasado); reuso de esa cookie → 401; (5) refresh/logout SIN cookie y SIN body (ni siquiera `{}` — POST sin Content-Type JSON, `req.body === undefined`) → 401 `UNAUTHORIZED` (NUNCA 400, anti-enumeración; cubre el `safeParse(req.body ?? {})` de T8); (6) `GET /auth/me` con `Cookie: access_token=<jwt>` y SIN Authorization → 401 idéntico al sin-token (mismo `x-request-id`); (7) independencia: `register` → `login` del mismo usuario (2ª sesión); reuso del refresh de la 1ª → el de la 2ª sigue 200. Ejecutar `npm test` COMPLETO. Must NOT: romper los 93 tests existentes (cuenta total final > 93); `as any`/`@ts-ignore`; headers duplicados manuales si `post` ya acepta headers (ver firma L30-80).
  Parallelization: Wave 3 | Blocked by: T2, T5, T6, T7, T8 | Blocks: F-wave
  References (executor has NO interview context - be exhaustive): `test/e2e.test.ts` L1-80 (imports, `buildApp`, helpers `post`/`get`/`startApp`, `AuthData`, `readJson`, `FakeGoogleVerifier`), L207-255 (describe US-03/US-04 — contexto `ctx.baseUrl`), L439 (fin del archivo — anexar el nuevo describe); node >=22 fetch (`headers.getSetCookie()`); `docs/06` §3.2/§3.3.
  Acceptance criteria (agent-executable): `npm test` exit 0 con el nuevo describe (7 `it`) — total de tests > 93; ninguno de los 93 previos alterado.
  QA scenarios: happy: `npx vitest run test/e2e.test.ts -t "transporte por cookie"` → 7/7; failure: correr el caso 5 a mano (sin cookie ni body) y verificar el cuerpo 401 genérico idéntico al token inválido (anti-enumeración). Evidence `.omo/evidence/task-11-dual-transport-multiclient.txt`.
  Commit: Y | `test(api): transporte dual por cookie (prioridad, logout, independencia de familias)`

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [ ] F1. Plan compliance audit — cada todo T1-T11 con evidencia en `.omo/evidence/`; acceptance criteria cumplidos (re-ejecutar typecheck/lint/test).
- [ ] F2. Code quality review — `npm run typecheck && npm run lint` limpios; sin `as any`/`@ts-ignore`/`@ts-expect-error`; sin catch vacíos; sin duplicación de la const de cookie.
- [ ] F3. Real manual QA — `npm run dev` real + curl: `-b`/`-c` con cookie jar: login → el jar contiene `refresh_token`; refresh SOLO con `-b jar` (sin body) → 200; logout → jar limpio; `GET /auth/me` con el access en cookie y sin Authorization → 401.
- [ ] F4. Scope fidelity — audit de Must NOT have: sin access en cookie (emitido ni leído), sin refresh por Bearer, sin detección de cliente, sin CSRF tokens, sin logoutAll, sin migración extra (solo el drop de FK).
- [ ] F5. Security review (cambio sensible) — HttpOnly + SameSite=Lax, Secure solo en prod, CORS `credentials: true` con allowlist (nunca `*`), CSRF mitigado por Content-Type JSON, reuso revoca SOLO su familia (independencia web/móvil verificada por T11-7).

## Commit strategy
- Un commit conventional por todo (11 commits), según el Commit de cada todo; TODOS con `TypeScript` desplegable en orden Wave 1 → 2 → 3.
- T2 es edición manual, NO `git revert` (el fallback previo convive con la feature; un revert podría chocar con líneas circundantes).
- Primero `npm run db:generate` (T5) — el SQL generado se revisa y se commitea junto con T5.
- No hay release/tag; historial lineal con mensajes en inglés.

## Success criteria
- `requireAuth` resuelve el access SOLO de `Authorization: Bearer`; ninguna ruta lee access de cookie (T2 + T11-6).
- register/login/google/magic-consume/refresh emiten el par en body Y `Set-Cookie: refresh_token` con HttpOnly, SameSite=Lax, Secure[prod], Path=/api/v1/auth, Max-Age=refreshTtl; logout limpia la cookie (T1, T3, T8).
- refresh/logout aceptan cookie (prioridad) o body; sin ambas → 401 `UNAUTHORIZED` genérico (T8; T11-2/3/5).
- CORS `credentials: true` con la allowlist estricta (T1).
- `family_id` = UUID por sesión; rotación hereda el presentado; reuso revoca la familia completa pero SOLO esa (T4, T6, T7; T11-7).
- FK `family_id → users` eliminada vía migración auto-aplicada en boot (T5).
- `src/contract.ts` regenerado: `cookie` deja de ser `never` en refresh/logout (T9).
- docs 00/04/06 actualizados (T10).
- `npm run typecheck`, `npm run lint`, `npm test` verdes; suites nuevas (7 casos) pasando; 93 existentes intactos (T11 + F-wave).