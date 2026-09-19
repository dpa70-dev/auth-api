# 05 · QA — Verificación de Arquitectura — API Signup/Login

**Stack**: Node.js · Express · TypeScript · Clean Architecture · SQLite · Drizzle · JWT · UUID · argon2 · jose · OIDC (Google)
**Estado de este documento**: Registro conceptual del QA de arquitectura — sucesión de revisiones aplicadas a `src/` tras la fase 3 de implementación (cada tema consolida una decisión bajo el mismo criterio: **fuente de verdad única y dirección de la dependencia**). Complementa los documentos `00-consideraciones-tecnicas.md`, `01-historias-de-usuario.md`, `02-flujos-registro-autenticacion.md` y `04-modelo-de-datos.md`.
**Metodología**: Revisión incremental verificada con evidencia dura tras cada paso — `typecheck`, `lint` (eslint), `vitest` (33/33, 2 archivos de test) y `build` (tsc) limpios; greps de referencia cruzada para confirmar cero dependencias/imports residuales. Cada tema describe el **concepto** de la revisión, no el diff aplicado.

---

## 1. Hilo conductor del QA

Todas las revisiones del QA giran alrededor de **un mismo criterio arquitectónico**, aplicado en ~21 instancias a lo largo de distintas fases:

1. **El dominio es dueño de su semántica** y no debe acoplarse a las capas externas (Express, SQLite, artefactos generados, la raíz como "shared kernel" ad-hoc).
2. **Unir cabos / single source of truth** — eliminar duplicación y drift donde haya dos fuentes de verdad para el mismo hecho.
3. **Dejar que el compilador garantice invariantes** — tipos que excluyen estados ilegales, uniones derivadas de catálogos, exhaustividad verificada por `tsc`.

Los patrones que se repiten como mantras del proyecto: *"el dominio no conoce a nadie externo"*, *"cada archivo exporta lo que crea"*, *"unir cabos"*.

---

## 2. Fase 0 · Verificación de principios (SOLID · Clean Code · Clean Architecture)

Arranque del QA: auditoría de la base arquitectónica del proyecto.

1. **Dependencia estricta hacia adentro en las capas** — el dominio no debe conocer/saber nada de Express, SQLite ni de la capa de presentación. Regla fundacional de Clean Architecture: la dependencia apunta hacia el centro, nunca hacia afuera.
2. **Principio de Inversión de Dependencias (DIP)** — los use cases dependen de interfaces/puertos, no de implementaciones concretas; el cableado se inyecta por constructor (L — Liskov: adaptadores en memoria/BD intercambiables).
3. **SRP · Responsabilidad única** — cada módulo con un solo motivo de cambio; coherencia interna de cada archivo (regla del repo: ≤ 250 LOC, sin "*Service*" genéricos).
4. **OCP · Abierto/Cerrado** — extensión vía adaptadores y catálogos, no modificación del core.
5. **Tipos que excluyen estados ilegales** — *parse, don't validate*; VOs brandeados; el compilador como guarda (Clean Code).
6. **Errores explícitos y tipados** — jerarquía de errores, manejo centralizado, sin estados ilegales representables.

---

## 3. Fase 1 · Fuente única del vocabulario de errores (DRY / single source of truth)

7. **`ApiError` no se instancia con literales hardcodeados** — el código de error proviene de un catálogo, no de strings sueltos esparcidos en los call-sites.
8. **`defaultMessage` (switch-case) reunido en un `Record` exhaustivo** — "unir cabos": el cálculo del mensaje por defecto se centraliza y el compilador garantiza la exhaustividad del catálogo.
9. **Dirección de la dependencia dominio→API** — el catálogo de errores es concepto de *dominio*; la capa API lo importa desde el dominio, no al revés. *(Mismo criterio aplicado a `logEvents` y a `ValidationIssue` vs `contract.ts` en fases posteriores.)*

---

## 4. Fase 2 · Vocabulario de logging (ubicación + tipado)

10. **Ubicación del vocabulario de eventos de log** — no vive en la raíz como "shared kernel" ad-hoc; es el *payload del puerto `Logger`*, así que vive junto a su puerto en `domain/port`.
11. **Tipar el puerto `Logger` con una unión de eventos** — *compilar = no hay typos* que romperían el monitoreo en silencio (tipos que excluyen estados ilegales aplicados al log).

---

## 5. Fase 3 · Naming y cohesión de archivos

12. **No colocar bajo un nombre genérico múltiples conceptos inconexos** — un "kitchen sink" debe poder nombrarse de forma que cada archivo exprese qué contiene (reagrupó un archivo de errores en piezas homogéneas).
13. **Convención de nombres de archivo = símbolo dominante** — el archivo se nombra por su símbolo principal (`apiError.ts` → `ApiError`, como `logger.ts` → `Logger`).

---

## 6. Fase 4 · Qué pertenece al dominio (límites del dominio)

14. **La política de negocio pura pertenece al dominio** — aunque sea trivial: la sentencia de expiración del refresh token es regla de negocio, no detalle de infraestructura. *"Pequeño no significa no-dominio."* La regla completa (emitir `refreshExpiresAt` y verificar `isRefreshExpired`) vive en el dominio, tipada y testeable sin Express/jose/SQLite.
15. **El dominio no importa artefactos ajenos** — `errorCatalog.ts` no debe importar el `contract.ts` generado desde el OpenAPI spec. El dominio es autónomo: *"el contrato se conforma al dominio, no al revés"*. Un tipo de dominio (`ValidationIssue`) se define de forma pura en el dominio; la compatibilidad estructural con el schema generado detecta el drift en `tsc` donde toca.
16. **No re-exportar tipos que no creaste** — el re-export de tipos ajenos crea alias que ocultan la fuente real del tipo. Cada archivo importa cada tipo de donde vive.

---

## 7. Fase 5 · Entidades vs records (duplicación y fuente única)

17. **No duplicar tipos idénticos en paralelo** — *"duplicate types only where evolution is independent"*: con misma forma y mismo lugar, el tipo espejo es un costo (dos fuentes de verdad), no una frontera. Aquí se confluyó el `UserRecord` del port hacia la entidad `User` del dominio.
18. **Nota de decisión de diseño** — documentar cuándo una frontera consciente podría volver a separarse: la persistencia puede divergir de la entidad en el futuro (auditoría, JOINs, columnas propias); en ese punto `UserRecord` se desacopla sin mutar la entidad.

---

## 8. Fase 6 · Elementos huérfanos (código muerto / disconnected)

19. **Detectar código muerto por análisis de grafo** — archivos y exports sin ningún consumidor real, incluidos *barrels* que nadie importa.
20. **Consecuencia del drift arquitectónico** — un subárbol de "entidades del dominio" quedó huérfano porque el sistema terminó operando sobre records/puertos en vez de las entidades validadas (reliquia de un diseño no cableado, con validación duplicada en los VOs).
21. **Eliminar solo lo realmente muerto, conservando lo vivo** — distinguir entre eliminar código huérfano (entidad hermana sin uso, tipos derivados de tabla sin consumidor, barrel sin uso) y conservar la entidad que sí alimenta al sistema; purgar también los artefactos compilados stale en `dist/` (tsc no vacía el `outDir` al borrar un fuente).

---

## 9. Temas pendientes del tintero

Registrados durante el QA. Estado de cierre:

- **Resuelto** — Variante `GOOGLE_ISSUER` en `.env.example`: catálogo completo de configuración documentado (criterio: variables con default = override-ables, no imperativas).
- **Resuelto** — Tema oscuro en Swagger: **in aplica**. El canal de documentación OpenAPI pasó a ser **https://editor.swagger.io/** (tiene modo oscuro nativo); se descartaron las previsualizaciones HTML locales (`03-swagger.html` y `03-openapi.html` borradas). El contrato fuente sigue siendo `03-openapi.yaml`.
- **Resuelto** — Fallback de `iat`/`exp` en la validación de tokens: eliminado el fallback inalcanzable/engañoso en `joseTokenService.ts` (ver §8).
- **Resuelto** — Nonce vs documento `04-modelo-de-datos.md`: se implementó el anti-replay condicional (opción B). El nonce ya no se propaga a `GoogleClaims` (dato efímero de la transacción); se valida dentro del verifier contra el `expectedNonce` del body si el JWT lo incluye (si no → 401). `GoogleRequest` ganó `nonce?` opcional en el contrato. De paso se corrigió el typo `verifyyy` → `verify` del puerto (5 archivos).

---

## 10. Cierre del QA (estado al 31-ago-2026)

- Todos los temas de las fases 0–6 aplicados y verificados: `typecheck` ✓ · `lint` ✓ · `vitest` **34/34** ✓ · `build` ✓. *(Conteo al cierre del 31-ago-2026; el estado vigente del repo es `vitest` **165/165** en 19 archivos — ver §16/§17.)*
- De los pendientes del tintero: **los 4 resueltos** — #1 (`GOOGLE_ISSUER` en `.env.example`), #2 (canal Swagger → editor.swagger.io), #3 (fallback `iat`/`exp`) y #4 (nonce anti-replay condicional + typo `verifyyy`).
- Greps de referencia cruzada confirman: **0** referencias residuales a lo eliminado, **0** re-exports de tipos ajenos en las capas, dominio autónomo (0 imports hacia artefactos externos).

---

## 11. Tema tratado — Multi-frontend y transporte del token (01-sep-2026)

Registrado tras el cierre, a raíz de la consulta "¿puede una misma cuenta usarse desde web y móvil?".

- **Multi-frontend: sí, soportado por diseño.** El access token es stateless (JWT: firma + `exp` + `sub`); `refresh_tokens` admite **N filas por `user_id`** (cada login = una sesión con su propia familia UUID); CORS por allowlist con `credentials: true` (`cfg.corsOrigins`; el móvil no aplica CORS). El mismo usuario puede estar logueado en web y móvil a la vez sin interferencia.
- **Transporte implementado (dual, 11-sep-2026):** access en `Authorization: Bearer` (middleware propio, única fuente — nunca cookie); refresh con **emisión dual** — cookie httpOnly (`refresh_token`) + body en todas las respuestas que generan refresh; `/auth/refresh` y `/auth/logout` leen la cookie primero y el body después (`refreshToken` opcional en el contrato). CORS con `credentials: true`. CSRF mitigado por `SameSite=Lax` + `Content-Type: application/json`. (Actualiza el registro previo "100% Bearer/body" del 01-sep-2026.)
- **Granularidad de revocación (11-sep-2026):** `family_id` = UUID de **sesión** (uno por login) → logout/detección de reuso revocan **solo la sesión del dispositivo**; la rotación hereda la familia. La revocación global por usuario (`revokeAllForUser`) queda restringida a cambio/reset de password (F1 de US-11/US-12). (Actualiza el registro previo `family_id = user_id` del 01-sep-2026.)

Estado: tema tratado y registrado; transporte dual y `family_id` por sesión **implementados** (11-sep-2026). El detalle extenso de las recomendaciones (transporte por cliente y `family_id` por sesión) está en **`06-recomendaciones-transporte-multi-frontend.md`**.

---

## 12. Tema tratado — Composite root: composición de dependencias (01-sep-2026)

Refactor aplicado para descongestionar `src/index.ts` y, sobre todo, para **asignar la construcción de cada cosa a su capa correcta**.

**Problema**: `index.ts` (~121 líneas) instanciaba implementaciones de puertos (hasher, tokens, users, google, logger), abría/configuraba la DB, construía los casos de uso y montaba Express — demasiada responsabilidad en un solo archivo de bootstrap.

**Solución aplicada — tres responsabilidades en tres capas**:

- **`src/app/useCases.ts`** (nuevo, capa application): define `UseCases`, `UseCasePorts` y `buildUseCases(ports, logger)`. **La capa de aplicación es dueña de construir sus propios casos de uso** — es orquestación de negocio, no implementación de puertos externos. Solo importa `domain` (interfaces) y los use cases de app. `routes.ts` ahora importa `UseCases` desde aquí (presentation → application).
- **`src/infra/compose.ts`** (reescrito, capa infra): `composeInfra(overrides, cfg)` **solo instancia las implementaciones reales** de los puertos (`Argon2PasswordHasher`, `JoseTokenService`, `DrizzleUserRepository`, `GoogleIdTokenVerifierJose`, `PinoLogger`), aplica los overrides de test (db, google, logger) y devuelve `InfraPorts` + `close`. **Ya no construye los casos de uso.**
- **`src/index.ts`** (descongestionado, bootstrap): **punto único de ensamblado** — recibe `InfraPorts` de `composeInfra`, llama `buildUseCases` de app para armar los casos de uso, y monta Express/helmet/cors/pino-http/json + `apiRouter` + error handlers. `AppDeps = ComposeOverrides` conserva la firma `buildApp({ db, google, logger })` que usan los tests.

**Decisión de diseño clave**: los casos de uso **no** se construyen en infra a pesar de que infra *puede* importar application (la regla de dependencia lo permite, las capas interiores no conocen a las exteriores). Se los mantiene en `application` porque la orquestación de negocio pertenece a esa capa; infra solo implementa la periferia (DB, HTTP, cripto). El **composite root / bootstrap (`index.ts`) es la única capa transversal** autorizada a ensamblar dependencias de todas las capas.

**Verificación**: `typecheck` ✓ · `lint` ✓ · `vitest` **34/34** ✓ (sin cambios en los tests — la inyección via `AppDeps` se preservó) · `build` ✓ · grep: 0 referencias residuales a `composeApp`/`ComposedApp`.

---

## 13. Tema tratado — Middleware en la capa de presentación (01-sep-2026)

Refactor aplicado para ubicar cada middleware en su capa correcta (presentación define el contrato HTTP; el bootstrap solo lo monta).

**Desalineamiento detectado**: `requireAuth` vivía en `src/app/authMiddleware.ts`, pero es **presentación pura** — lee `req.headers.authorization`, escribe `req.userId`, depende de `express.RequestHandler` y lanza `ApiError` HTTP. No contiene lógica de aplicación. Se movió a `src/api/authMiddleware.ts`.

**Middlewares que quedaron en presentación (`src/api/`)**:
- `authMiddleware.ts` — `requireAuth` (US-05, token/middleware de acceso), movido desde `app/`.
- `middleware.ts` (nuevo) — `httpLoggerConfig` (factory de la config de pino-http: genReqId, niveles por status, `x-request-id`) y `requestIdMiddleware` (propaga el requestId al `req.requestId` del envelope y al contexto ALS de logging).
- `errorMiddleware.ts` — `notFound` y `finalErrorHandler` (ya estaban en presentación).

**Desacople del contexto por request**: el middleware de requestId necesita el `requestContext` (AsyncLocalStorage de infra). Para que la presentación **no importe infra**, `middleware.ts` define un puerto mínimo `RequestContext` (con `run`) y lo recibe **inyectado**. `index.ts` (bootstrap, capa transversal) es quien importa `requestContext` de infra y lo inyecta: `requestIdMiddleware(requestContext)`. Se mantiene la regla presentación→infra (0 imports).

**Lo que NO se extrajo (decisión)**: `helmet`, `cors` y `express.json` son middleware de terceros con **config trivial** (1 línea) y pertenecen al bootstrap de Express. Extraerlos a un archivo propio sería indirección sin beneficio.

**Resultado en `index.ts`**: quedó en bootstrap puro (58 líneas) — compone infra, ensambla use cases, monta middleware (de presentación + de terceros) y define el arranque del servidor. Ninguna *definición* de middleware HTTP vive ya en `index.ts`.

**Verificación**: `typecheck` ✓ · `lint` ✓ · `vitest` **34/34** ✓ · `build` ✓ · grep: 0 referencias a `app/authMiddleware`; 0 imports de `infra/pinoLogger` desde `src/api/`; `app/` quedó sin middleware (puro use cases).

---

## 14. Tema tratado — Config unificada con tipos derivados de Zod (01-sep-2026)

Consolidación de la configuración de entorno en un único `src/config.ts`, eliminando el borrador `src/config2.ts`.

**Contexto**: existían dos implementaciones equivalentes de la configuración — `config.ts` (activo) y `config2.ts` (borrador no referenciado en ningún lado). Ambos validaban las mismas env con el mismo schema Zod y producían el mismo objeto `config` (verificado: tipos `Config` y `NodeEnv` **idénticos** entre ambos con `Equal<>`, y defaults de rate-limit/CORS equivalentes en runtime).

**Bug detectado en `config2.ts`**: los defaults de Google apuntaban a `https://google.com` (hosting corporativo) en vez de `https://accounts.google.com` (emisor OIDC). Con esos defaults el login de Google fallaría: el ID token emite `iss: https://accounts.google.com` y la verificación (doc 00 → ítem 44) rechazaría `google.com`. El error quedó evidenciado en runtime con las mismas env (sin `GOOGLE_ISSUER`/`GOOGLE_JWKS_URL`): `config.ts` → `accounts.google.com`, `config2.ts` → `google.com`.

**Cambio aplicado** — se adoptó el estilo DRY de `config2.ts` corregido como nuevo `config.ts`:
- `Config = z.infer<typeof envSchema>` (output del `.transform`) y `NodeEnv = Config['nodeEnv']`: **el shape se deriva de una única fuente** (el schema Zod transformado), eliminando la duplicación manual del tipo `Config` y del mapeo `config` que había en `config.ts`.
- Se corrigió el default de Google a `accounts.google.com` para `GOOGLE_ISSUER` y `GOOGLE_JWKS_URL` (bug de `config2.ts` no heredado).
- Se eliminó el bloque comentado de referencia (`type envJson`) que había en `config.ts` (código muerto).
- Se eliminó `src/config2.ts` (absorbido por `config.ts`); 0 referencias residuales en `src/`/`test/`.

**Los consumers no cambiaron**: `NodeEnv` (pinoLogger) y `Config` (compose, routes, index) seguían importando de `./config.js`/`../config.js`; al mantener el nombre de archivo, los imports quedan intactos y tipan igual (tipos idénticos).

**Verificación**: `typecheck` ✓ · `lint` ✓ · `vitest` **34/34** ✓ · `build` ✓ · runtime (tsx, sin env de Google): `issuer: ["https://accounts.google.com"]` · `nodeEnv: "development"` · rate-limit defaults intactos · grep: 0 referencias a `config2`.

## 15. Tema tratado — Magic link: acceso sin contraseña (3-sep-2026)

Implementación completa del flujo de magic link (US-09/US-10) siguiendo el plan aprobado en `.omo/plans/magic-link.md`.

**Decisiones del plan (ratificadas por el usuario)**:
- **Auto-cuenta**: el primer link de un email no registrado crea la cuenta al consumirse (`provider = 'magic'`, `email_verified = 1`).
- **Token opaco 32 bytes** + hash SHA-256 en `magic_links` (patrón ya usado en `refresh_tokens`).
- **`provider = 'magic'`** ampliando el enum `['local','google'] → ['local','google','magic']`.
- **Puerto `EmailSender`** con adapter de consola (dev); smtp en prod sin tocar el caso de uso.
- **`emailVerified = true`** al consumir un link válido.

**Deviación del plan detectada en implementación** (corregida y nota conceptual): el plan original recomendaba "no generar/persistir/enviar nada si el email no existe" (anti-enumeración total, opción A). Esto es **incompatible con la auto-cuenta**: un usuario nuevo jamás recibiría el link. Se adoptó la **opción B** — `request` genera/persiste/envía **siempre** (trabajo idéntico en ambos casos) con respuesta `200 { ok: true }` idéntica. La anti-enumeración se conserva (misma respuesta + mismo trabajo + sin side-channel temporal) y la auto-cuenta queda habilitada.

**Verificación de arquitectura** (nuevos puertos/adapters del magic link):
- `MagicLinkRepository` (puerto, domain/port) → `DrizzleMagicLinkRepository` (infra), inyectado por constructor en `RequestMagicLink`/`ConsumeMagicLink` — DIP respetado (doc 00 → ítem 26).
- `EmailSender` (puerto) → `ConsoleEmailSender` (infra): adapter intercambiable sin tocar el use case (doc 00 → ítem 55).
- `markEmailVerified` añadido al puerto `UserRepository` y su impl Drizzle — transición de estado `email_verified = 1` (posesión de email probada).
- CHECK de identidad `users` ampliado (`... OR email_verified = 1`, doc 04 → decisión 5) y CHECK de `provider` ampliado a `magic` — el alta implícita de auto-cuenta es persistible.
- `ConsumeMagicLink` reutiliza `TokenIssuer.issueSession` (misma emisión/rotación que `/login` y `/google`); las sesiones magic usan nuestros refresh (doc 00 → ítem 47).

**Verificación**: `typecheck` ✓ · `lint` ✓ · `vitest` **44/44** (34 previos + 10 nuevos de magic link en `test/magicLink.test.ts`) ✓ · `build` ✓ · OpenAPI validado con `@redocly/cli` (0 errores) ✓ · `src/contract.ts` regenerado con `openapi-typescript` ✓. *(Conteo al 3-sep-2026; el estado vigente del repo es `vitest` **165/165** en 19 archivos — OTP (US-13/14) y guest (US-15/16): ver §16/§17, docs/05 §11, docs/08 y commits `1c2b8ef`/`b526789`.)*

---

## 16. Tema tratado — Código OTP: acceso sin contraseña por email (19-sep-2026)

Implementación completa del flujo OTP (US-13/US-14) siguiendo el plan aprobado en `.omo/plans/otp-guest.md` (Track A).

**Decisiones del plan (ratificadas por el usuario)**:
- **Hash argon2id, no SHA-256**: un código de 6 dígitos (`randomInt(0, 1_000_000).padStart(6, '0')`) es brute-forceable offline — el hash lento (m=19456, t=2, p=1) encarece cada intento y `otp_codes` guarda solo `code_hash` (doc 00 → ítem 34/35).
- **Anti-enumeración (opción B, misma lección que magic link §15)**: `request` genera/persiste/envía **siempre** (exista o no el email) con `200 { ok: true }` idéntico — es lo que habilita la **auto-cuenta** en el verify (espejo US-10 AC-02).
- **Rotación (US-13 AC-03)**: un request nuevo **revoca** el pendiente anterior del mismo email (`revokeAllForEmail`) — un solo código vigente por email.
- **Máx 5 intentos (US-14 AC-03)**: `attempts >= 5` → `markStatus(revoked)` y fuerza un nuevo request; el límite es persistente (columna `attempts`), no rate-limit de red.
- **Un solo uso (US-14 AC-02)**: `markStatus(used)` tras la verificación; reuso → 401 idéntico.
- **Auto-cuenta (US-14 AC-04)**: email no registrado → usuario sin password con `email_verified = 1` (`provider = 'otp'`); email registrado → `markEmailVerified`.
- **NO es 2FA**: el OTP es el único factor de entrada (login passwordless para la app móvil), no un segundo factor — 2FA sigue fuera de alcance (doc 01).

**Verificación de arquitectura** (nuevos puertos/adapters del OTP):
- `OtpRepository` (puerto, domain/port) → `DrizzleOtpRepository` (infra), inyectado por constructor en `RequestOtp`/`VerifyOtp` — DIP respetado (doc 00 → ítem 26).
- `EmailSender.sendOtpCode` añadido al puerto existente + su impl en `ConsoleEmailSender` — adapter intercambiable sin tocar los use cases (doc 00 → ítem 55).
- VOs `OtpCode` (6 dígitos, zod branded) y `OtpStatus` (`pending`/`used`/`revoked`) en `domain/vo/`; `providerValues` ampliado a `['local','google','magic','otp']` (doc 04 → decisión 6).
- Tabla `otp_codes` + migración `0004_premium_warbound.sql` (doc 04 → decisiones 9-11); CHECKs derivados de los VOs vía `inList` (fuente única, mismo patrón que magic_links).
- `VerifyOtp` reutiliza `TokenIssuer.issueSession` (misma emisión/rotación que `/login`, `/google` y magic link); sesiones OTP usan nuestros refresh (doc 00 → ítem 47).
- **Unit of Work (doc 13 → §13.1)**: verificación argon2 + lectura de usuario + emisión jose **fuera** de la tx; dentro, solo las escrituras atómicas (auto-cuenta/`markEmailVerified` + `markStatus(used)` + `insertRefreshToken`).
- Errores solo desde catálogo: `OTP_INVALID` (sin literales en call-sites) → 401 en `errorMiddleware`; `LOG_EVENTS` OTP_* para trazabilidad.

**Verificación**: `typecheck` ✓ · `lint` ✓ · `vitest` **136/136** en 15 archivos (106 previos + 30 nuevos: `otpCode.test.ts` 7 + `requestOtp.test.ts` 3 + `verifyOtp.test.ts` 9 + `otp.test.ts` 11) ✓ · `build` ✓ · OpenAPI validado con `@redocly/cli` (0 errores) ✓ · `src/contract.ts` regenerado ✓ · merge `feat/otp` a main `--no-ff` ✓. *(Estado al cierre de OTP; el estado vigente del repo al 19-sep-2026 es `vitest` **165/165** en 19 archivos — ver §17.)*

---

## 17. Tema tratado — Cuenta de invitado guest (19-sep-2026)

Implementación completa del flujo guest (US-15/US-16) siguiendo el plan aprobado en `.omo/plans/otp-guest.md` (Track B).

**Decisiones del plan (ratificadas por el usuario)**:
- **`kind` = discriminador de tipo de cuenta, NO rol**: columna `users.kind` (`'registered'`/`'guest'`, VO `UserKind`, DEFAULT `'registered'` retrocompatible — las filas preexistentes quedan registradas sin migración de datos). Roles/autorización (futura `role`) y estados de moderación son ejes independientes que `kind` NO absorbe (sin kitchen-sink — SRP).
- **`users.email` nullable**: el guest no tiene identidad; `email` pasa a nullable en el esquema y el **unique index sigue válido** (SQLite tolera múltiples NULL). Migración `0005` = table-rebuild verificada (INSERT copia datos; la columna `kind` se omite del SELECT y el DEFAULT `'registered'` la llena — corrección a mano de drizzle-kit).
- **CHECK de identidad ampliado**: `(password_hash IS NOT NULL OR google_sub IS NOT NULL OR email_verified = 1 OR kind = 'guest')` — el guest es la única cuenta que puede existir sin identidad.
- **Cada request crea un guest nuevo** (sin dedup); sesión emitida con `provider = 'guest'`; el guest navega endpoints protegidos (US-15 AC-04).
- **Upgrade NO revoca sesiones** (decisión aprobada): la sesión guest (access + refresh) sigue sirviendo tras reclamar email+password; `email_verified` queda `0` (se verifica después vía magic link/OTP, como un registro local).
- **409 para ambos fallos de upgrade**: `GUEST_UPGRADE_INVALID` (cuenta no guest) + `EMAIL_ALREADY_EXISTS` (email ocupado); password validada con la misma pipeline de US-01 (fuerza NIST + compromised); `requireAuth` obligatorio (es un upgrade de la propia cuenta).

**Verificación de arquitectura**:
- VO `UserKind` (`userKindValues`, zod enum) en `domain/vo/` + `providerValues` ampliado a `['local','google','magic','otp','guest']` (doc 04 → decisión 6).
- Entidad `User`/`NewUser`: `email: Email | null` + `kind: UserKind`; refine de identidad actualizado (guest permitido sin identidad).
- `CreateGuestSession` y `UpgradeGuestAccount` injetan los puertos existentes (`UserRepository`, `PasswordHasher`, `CompromisedPasswordChecker`, `TokenIssuer`, `UnitOfWork`) — DIP respetado; sin puertos nuevos (reutiliza todo el molde).
- Unit of Work (doc 13 → §13.1): verificación/hasheo **fuera** de la tx; dentro solo las escrituras (insert usuario + refresh / update email+password+kind).
- Errores solo desde catálogo: `GUEST_UPGRADE_INVALID` → 409 en `errorMiddleware`; `LOG_EVENTS` `GUEST_SESSION_CREATED`/`GUEST_UPGRADED`.
- Drift del contrato (T8: `email` nullable + `kind` en User) resuelto en los 6 use cases que emiten sesiones: resultados con `email: Email | null` + `kind` (`'registered'` en login/register/otp/magic, `UserKind` en google); `getMe` devuelve `user.kind`. Todos los handlers vuelven a tipar contra `AuthResponseData`/`UserProfileData` (sin `as any`).

**Verificación**: `typecheck` ✓ · `lint` ✓ · `vitest` **165/165** en 19 archivos (154 previos + 11 nuevos en `test/guest.test.ts`: creación/me/refresh/upgrade/409s/401/422/429) ✓ · `build` ✓ · smoke curl guest→me→upgrade→me OK ✓ · merge `feat/guest-user` a main `--no-ff` ✓. *(Estado vigente del repo al 19-sep-2026.)*
