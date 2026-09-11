# 00 · Consideraciones Técnicas — API Signup/Login

**Stack**: Node.js · Express · TypeScript · Clean Architecture · SQLite · Drizzle · JWT · UUID · argon2 · jose · OIDC (Google)
**Estado de este documento**: Baja de decisiones técnicas consolidada — fase de documentación + implementación. (Especificación OpenAPI de la fase 2 en `03-openapi.yaml`; modelo de datos derivado en `04-modelo-de-datos.md`. **Fase 3 completada el 29-ago-2026**: implementación contra el contrato en `src/`, 23 tests e2e en verde, `tsc`/eslint/build limpios, smoke con curl conforme al contrato. **Canal documental del contrato (31-ago-2026)**: la especificación se visualiza/verifica en **https://editor.swagger.io/** (modo oscuro nativo); se descartaron las previsualizaciones HTML locales `03-swagger.html` y `03-openapi.html`. El contrato fuente es el `03-openapi.yaml`.) **US-11/12 (5-sep-2026)**: cambio y recuperación de contraseña implementados y verificados — 74 tests en verde, `tsc`/eslint/build limpios.
**Metodología**: Veredictos verificados con evidencia dura al 27-ago-2026 (npm registry — versión y fecha de última publicación, nodejs.org — estado LTS y estabilidad de `node:sqlite`, cheat sheet vigente de OWASP). La sección final «Evidencia» respalda cada afirmación cambiante.

---

## 1. Principios de desarrollo (transversales)

### 1.1 Spec Driven Development (SDD)

- El **contrato de la API es la fuente de verdad** del comportamiento externo y se escribe **antes** del código.
- Orden del proyecto (fases): **historias de usuario + criterios de aceptación** (documento actual `01-historias-de-usuario.md`) → **especificación OpenAPI/Swagger** (fase siguiente, pendiente) → **implementación contra el contrato** → **verificación de contrato**.
- El código **jamás define el contrato a posteriori**: cualquier cambio en el contrato es un cambio deliberado, documentado y versionado.
- SDD define el **QUÉ** (contrato externo); TDD define el **CÓMO** (comportamiento interno). Se complementan, no compiten.
- En la fase de implementación se usarán herramientas de contrato: `openapi-typescript` (tipos derivados del OpenAPI), validación request/response contra el contrato (contract tests).
- **Consecuencia práctica**: ningún endpoint se implementa sin su especificación previa; cada historia de usuario evoluciona a esquemas OpenAPI con sus códigos de respuesta.

### 1.2 SOLID (mapeado a Clean Architecture)

| Principio | Cómo se aplica en este proyecto |
|---|---|
| **S** — Single Responsibility | Un módulo = una responsabilidad: controller / caso de uso / repositorio separados. Regla del equipo: ≤ 250 LOC por archivo; sin "God classes" ni `*Service` genéricos. |
| **O** — Open/Closed | Extensiones sin modificar el core: cambiar el proveedor de hashing (argon2 → scrypt) o de base de datos (SQLite → Postgres) implica **añadir un adaptador**, nunca tocar el dominio. |
| **L** — Liskov | Implementaciones sustituibles: `UserRepository` en memoria (tests) y SQLite (producción) se intercambian sin cambiar quien las usa. |
| **I** — Interface Segregation | Interfaces pequeñas y específicas: el caso de uso pide solo lo que necesita (`findByEmail`, `save`), no un CRUD gigante. |
| **D** — Dependency Inversion | El dominio depende de **puertos** (interfaces), nunca de librerías concretas ni de Express. Inyección por constructor en los casos de uso. |

### 1.3 Clean Code

- **P-01 — Nombres con intención**: `RegisterUserUseCase`, `hashPassword`, `findByEmail` — el nombre comunica propósito y nivel de abstracción, no mecanismo.
- **P-02 — Funciones pequeñas**: una sola cosa por función (~≤ 30 líneas), sin efectos ocultos, sin parámetros booleanos que cambian el flujo (flag envy → dividir la función).
- **P-03 — Comentarios solo para el "porqué"**: código que se auto-documenta; el comentario explica decisión de negocio o contexto no evidente, nunca re-explica el qué.
- **P-04 — Tipos que excluyen estados ilegales**: uniones discriminadas para errores y DTOs; evitar `null`/`undefined` vagos; el compilador debe hacer imposible el estado inválido. *(Materialización práctica: Value Objects brandeados con Zod en el dominio — ver sección 6.1.)*
- **P-05 — DRY con juicio**: abstrain en la tercera repetición (regla de tres); nada de over-engineering temprano (YAGNI/KISS).
- **P-06 — Errores explícitos y tempranos**: fallar rápido en el borde; sin excepciones mudas, `catch` vacíos ni conversiones `any`/`@ts-ignore`.

---

## 2. Runtime y lenguaje

1. **Node.js 24 LTS ("Krypton", v24.20.0) como base**: Active LTS hoy. Node 26 existe pero es Current, no LTS. Fijar con `.nvmrc` + `engines` en `package.json`.
2. **ESM como estándar** (`"type": "module"`). Sin CJS salvo que una dependencia lo exija. En TS: `moduleResolution: NodeNext`.
3. **TypeScript 7 (publicado, 7.0.2 jul-2026) + type-stripping nativo de Node**: Node ejecuta `.ts` directamente sin build. En dev: `node --watch` sobre `.ts`; `tsx` (4.23, activo) como fallback. TS 7 es el compilador nativo en Go (mucho más rápido).
4. **`strict: true` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`**: cero `any`/`@ts-ignore` (política del proyecto).
5. **Zod 4 como capa de validación** ("parse, don't validate"): 1.09B descargas/mes, estándar de facto. Un schema por DTO; mismos schemas para validar variables de entorno.

## 3. Framework y diseño de API

6. **Express 5 (5.2.1, dic-2025) — línea actual**: desde mar-2025 `npm i express` instala 5. Diferencias que afectan: errores async propagados solos (sin wrappers), wildcards `*` → `*splat`, `req.query` getter-only. Para un proyecto nuevo no hay argumento para Express 4.
7. **Env validado con schema al arranque** (fallar rápido); nunca `process.env` disperso por el código.
8. **UUID sin dependencia**: `crypto.randomUUID()` (nativo desde Node 19). El paquete `uuid` no se instala.
9. **Respuestas JSON consistentes**: envelope único de éxito/error definido en la sección «Manejo centralizado de errores y respuestas (400/500)»; semántica completa de códigos HTTP en `01-historias-de-usuario.md` (Convenciones transversales).

## 4. Logger (transversal)

10. **pino 10 como estándar** de logging estructurado (JSON, serializable, rápido). Prohibido `console.log` en el código de aplicación (regla de lint).
11. **pino-http para accesos**: un log por request (método, ruta, status, duración) y **generación y propagación de `requestId`** (`genReqId`) a todos los logs de esa request vía child loggers. El mismo `requestId` se devuelve en las respuestas (correlación cliente ↔ logs de soporte).
12. **Contexto por request**: `requestId`, `userId` (si autenticado) y `useCase` activo enriquecen cada log. El dominio no depende de pino: se define un puerto `Logger` (interfaz en domain) implementado con pino en infrastructure e inyectado en los casos de uso (DIP).
13. **Redacción de datos sensibles**: `redact` de pino para `password`, `refreshToken`, `authorization`, emails; serializadores custom que despojan hashes/tokens de cualquier objeto antes de loggear (jamás dump de la entidad `User` completa).
14. **Niveles por entorno**: dev → `trace`/`debug` + pino-pretty; test → `silent`/`warn`; prod → `info`. Semántica de nivel: errores 4xx esperados → `warn`; 5xx → `error`; fallo de arranque → `fatal`. Stack traces completos solo en dev.
15. **El dominio no loggea por su cuenta**: el logging es transversal y entra por inyección (puerto `Logger`). Las capas de dominio/application no importan pino ni escriben a stdout directamente (mantiene Clean Architecture y testabilidad).

## 5. Manejo centralizado de errores y respuestas (400/500)

16. **Un único middleware de error** (4 argumentos) registrado al final de la cadena Express. Todo error —esperado o no— converge ahí. Express 5 propaga automáticamente errores de handlers async, sin wrappers.
17. **Jerarquía de errores tipada**: base `AppError` (`statusCode` + `code` estable + mensaje de usuario) con subclases de dominio/infra (`InvalidCredentialsError` → 401, `EmailAlreadyExistsError` → 409, `ValidationError` → 422, …). Los **casos de uso lanzan errores de dominio y no saben de HTTP**; el middleware central los mapea al envelope.
18. **Centralización 400**: cualquier error de parseo de `express.json()` (JSON malformado → `entity.parse.failed`/`SyntaxError`), headers inválidos o payload malformado se normaliza a `400` con el mismo envelope — sin detalles internos.
19. **Centralización 422 (validación)**: los errores de schema (zod) se traducen a `422` con `details: [{ field, issue }]` y `code: VALIDATION_ERROR`. La semántica transversal queda fijada: `400` = formato/parse, `422` = reglas de validación.
20. **Centralización 500**: error inesperado o de infraestructura → respuesta genérica `{ error: { code: INTERNAL_ERROR, message: <genérico>, requestId } }`. **Nunca** stack traces, rutas internas, SQL ni valores sensibles en la respuesta. El detalle completo va solo al log, correlacionado por `requestId`.
21. **Envelope único de respuesta**: éxito `{ data }` y error `{ error: { code, message, details? } }`, generados por helpers centrales (`writeSuccess(res, status, data)` / `writeError(res, err)` tipados), no dispersos en los controllers.
22. **Caso borde `res.headersSent`**: si el error ocurre tras enviar headers, ya no se puede responder — el middleware loggea y delega en `next(err)` para que Express cierre la conexión. (No reventar con doble respuesta.)
23. **Los logs distinguen 4xx de 5xx** (`warn` vs `error`) con `requestId` + `userId` para diagnóstico: un 409 esperado no debe sonar como pánico; un 500 sí.
24. **404 y 405 también centralizados**: rutas/verbos inexistentes caen al middleware final como `AppError` (404 Not Found / 405 Method Not Allowed) con envelope uniforme — no respuestas HTML por defecto de Express.

## 6. Arquitectura (Clean Architecture)

25. **Capas con dependencia estricta hacia adentro**: `domain` (entidades, reglas, puertos) ← `application` (casos de uso) ← `infrastructure` (adapters: repos, db, hasher, tokens, logger); `presentation` (routes/controllers) delgada. El dominio jamás importa Express ni SQLite.
26. **Ports & Adapters**: interfaces en domain/application (`UserRepository`, `PasswordHasher`, `TokenService`, `Logger`), implementadas en infrastructure e inyectadas por constructor en los casos de uso. El core queda testeable sin infraestructura.
27. **Casos de uso como unidades de negocio**: `RegisterUser` · `Login` · `RefreshTokens` · `Logout`, cada uno con DTO de entrada/salida. Las entidades no se exponen crudas al JSON (evita leaks de `passwordHash`).
28. **Estructura de carpetas — decidido: por capas** (`src/{domain,application,infrastructure,presentation}`). La variante *por feature* (`src/modules/auth/**`) queda descartada para este ejemplo, aunque sigue siendo válida en general. Regla que se mantiene: la dependencia siempre apunta hacia adentro.

### 6.1 Domain modeling — Value Objects en el dominio

- **Decisión — los Value Objects son parte del dominio y se expresan con Zod 4 (tipos brandeados / branded types)**. Toda primitiva semántica del modelo es un VO con marca de tipo propia: un `Email` no es un `string` suelto, un `UserId` no es un `uuid` cualquiera (*one name = one concept*). Catálogo inicial (p. ej.): `Email` (normalizado, máx. 254), `PlainPassword` / `PasswordHash` (PHC argon2, del nº 35), `UserId` (UUID v4), `Jti` (id del refresh, del nº 38), `GoogleSub`, `Provider` (`local|google`, del nº 47), `EmailVerified` (confiable solo si `true`, del nº 44). El compilador vuelve **ilegal el estado inválido** (refuerza P-04, sección 1.3).
- **Zod en el dominio — excepción explícita a «el dominio no depende de librerías concretas» (nº 25)**: zod es una librería **pura, sin efectos ni I/O** (no es Express/SQLite/pino — infraestructura). El schema de zod **es** la definición del VO; `parse` en las fronteras produce el tipo branded y hacia adentro solo circulan valores ya válidos (*parse, don't validate* — sección 2, nº 5). Los VOs viven en `src/domain/value-objects/` (estructura del nº 28).
- **Composición, no duplicación**: los schemas de DTO de `presentation` e `infrastructure` (body HTTP, respuestas, env) se **componen** sobre los schemas de los VOs en vez de redeclararlos (DRY — P-05). La frontera parsea el input sucio **una sola vez**; el caso de uso recibe VOs tipados y no vuelve a validar (L/D — sección 1.2).
- **Testing**: cada VO lleva su test unitario colocado junto al archivo (happy path, límites y caminos de error del `parse`; verificación del branding a nivel de tipos). Testeo puro de dominio, sin infraestructura — primera rueda de la pirámide del nº 52.

## 7. Base de datos (SQLite)

29. **`node:sqlite` (built-in) vs better-sqlite3**: `node:sqlite` ya no requiere flag, pero **sigue en Stability 1.2 (Release candidate)** incluso en Node 26. Elección — decidido: **better-sqlite3** (13.0.3, ago-2026, 39.6M/mes, probado en producción) por su driver maduro en Drizzle (ver nº 33 y sección 12). `node:sqlite` queda documentado como alternativa futura cuando estabilice (Stability 1.2). Ambos síncronos — el viejo `sqlite3` async quedó atrás.
30. **Síncrono es correcto para SQLite**: no forzar async por dogma; la API síncrona simplifica los casos de uso y en una app local el impacto es despreciable.
31. **PRAGMAs obligatorias**: `journal_mode=WAL` (concurrencia de lectura), `foreign_keys=ON` (default en node:sqlite), `busy_timeout` ≥ 5000 ms (node:sqlite: opción `timeout`, que es **0 por defecto** — configurarla).
32. **Migraciones versionadas, jamás `sync()`**: drizzle-kit, Knex migrations o SQL files ordenados con tabla `schema_migrations`. Para el ejemplo, las dos últimas son suficientes.
33. **Acceso a datos — decidido: Drizzle ORM 0.45 (77M/mes, default TS-first)** con driver `better-sqlite3`. Esquemas tipados + SQL de Drizzle sobre el mismo engine elegido (nº 29). Prisma 8 va en RC (68M/mes) y Knex declina (21M/mes); el SQL directo con prepared statements queda como alternativa, no como elección.
34. **UUID como clave**: (a) `INTEGER PRIMARY KEY` interno + `uuid TEXT UNIQUE` expuesto, o (b) `TEXT PRIMARY KEY` directa con UUID. Regla de oro: **no exponer la clave autoincremental al cliente** (revela orden de creación). Para el ejemplo, (b) es suficiente.

## 8. Autenticación (núcleo del proyecto)

35. **Hashing — decidido: argon2id** (librería `argon2` 0.45, nativa, activa). Parámetros OWASP: m=19456 (19 MiB), t=2, p=1 (mínimo recomendado). Se descarta bcrypt (OWASP: "solo para sistemas legacy", work factor ≥ 10, máx. 72 bytes; pre-hashing con SHA-512 peligroso por password shucking). Interfaz `PasswordHasher` en domain → adapter argon2 en infrastructure (DIP) para migrar sin tocar el core.
> **¿Cómo se guarda la contraseña? (didáctico)** — **Hash ≠ cifrado**: cifrar es reversible (quien tiene la clave recupera el texto original); hashear es de un solo sentido — nadie, ni el server, puede recuperar la contraseña desde la DB. Por eso **nunca se "encriptan" contraseñas**: se guarda un hash.
>
> **Registro**: `PasswordHasher.hash(clave)` → argon2id genera un **salt único aleatorio por usuario** y aplica el algoritmo → se persiste un solo string PHC en `users.password_hash`:
> ```text
> $argon2id$v=19$m=19456,t=2,p=1$<salt base64>$<hash base64>
> ```
> El string autocontiene algoritmo, parámetros, salt y hash → verificar no requiere datos extra.
>
> **Login**: `UserRepository.findByEmail()` → `PasswordHasher.verify(clave, phc)` re-ejecuta el mismo algoritmo con el salt embebido y compara en **tiempo constante** → `true` emite tokens; `false` → 401 genérico (anti-enumeración, nº 41).
>
> **Por qué es seguro**: salt único por usuario (misma clave → hash distinto; rainbow tables inútiles), algoritmo **memory-hard** (~19 MiB, t=2, p=1 = lento por diseño, inviable con GPU), comparación en tiempo constante. Parámetros: mínimo OWASP.
>
> **Capas**: domain define `PasswordHasher` (interfaz); infrastructure implementa `Argon2PasswordHasher`; application usa solo la interfaz (DIP/OCP) → migrar de proveedor no toca el core.
36. **JWT — decidido: `jose` (6.2.10, ago-2026, activa)**: 473M/mes vs 232M de jsonwebtoken, API WebCrypto/ESM. jsonwebtoken es la generación anterior y queda descartado. Toda la emisión/verificación vive tras el puerto `TokenIssuer`.
37. **Autenticación de request — decidido: middleware propio con `jose.jwtVerify`** (~30 líneas) en `presentation`. **Passport queda descartado** (0.7.0 nov-2023, ~3 años sin releases; passport-jwt 4.0.1 dic-2022): no aporta valor frente a un middleware propio con jose y evita la capa de abstracción legacy. El algoritmo de verificación se fija en el middleware (nunca se confía en el header `alg`).
38. **Patrón access + refresh con rotación**: access de 5–15 min (claims: `exp`, `iat`, `nbf`, `jti`, `sub`, `iss`/`aud`); refresh de 7–30 días **guardado hasheado en DB** con su `jti`; **rotar en cada refresh y detectar reuso** (refresh ya usado presentado de nuevo → revocar toda la familia de tokens del usuario). Nunca datos sensibles en el payload.
39. **Transporte — dual (11-sep-2026): access Bearer-only + refresh cookie/body**: access token siempre en `Authorization: Bearer` (middleware propio, única fuente — nunca cookie). El refresh viaja por **cookie httpOnly** (`refresh_token`: Secure en prod, SameSite=Lax, Path=`/api/v1/auth`, Max-Age=TTL) **Y** por el body de las respuestas (emisión dual sin detectar cliente); `/auth/refresh` y `/auth/logout` leen la cookie primero y el body después (el campo `refreshToken` del body es opcional; sin ninguna fuente → 401 genérico). CORS con **allowlist y `credentials: true`**. CSRF mitigado por SameSite=Lax + exigencia de `Content-Type: application/json` (express.json) — sin token CSRF. Recomendaciones detalladas por tipo de cliente y multi-frontend en **`docs/06-recomendaciones-transporte-multi-frontend.md`**.
40. **Firma**: HS256 con clave de 256 bits (`crypto.randomBytes(32).toString('base64')`) es suficiente para un servicio; RS256/ES256 si se piensa en multi-servicio. **Fijar el algoritmo en la verificación** — jamás confiar en el header `alg`.
41. **Hardening del login**: rate limiting en `/login` y `/refresh` (express-rate-limit), **mensajes genéricos** ("credenciales inválidas" — nunca revelar si el email existe = anti-enumeración), lockout/backoff opcional. NIST 800-63B: contraseña por **longitud (mín. 8, ideal 15+) y no complejidad**; máximo 64 caracteres; sin rotación forzada.
42. **Logout**: revocar el refresh (borrarlo de DB); con access corto no se necesita blocklist de access tokens.

### 8.1 Autenticación con proveedor externo — Google (OIDC)

43. **Flujo — decidido: token flow de Google Identity Services (GIS) + verificación con `jose`**. La SPA obtiene el ID token con "Sign in with Google" y lo envía a `POST /api/v1/auth/google`. El server verifica el token **siempre server-side** y emite su propio par access+refresh (idéntico a `/login` local). **Cero dependencias nuevas**: no se instala openid-client ni librería de Google. El code flow (OAuth 2.1, PKCE) queda documentado como alternativa solo si el cliente fuera server-rendered o nativo.
44. **Reglas de verificación del ID token (jose)**: `aud` = client_id de Google configurado (rechazar cualquier otro), `iss` = `accounts.google.com`, `exp`/`iat` dentro de ventana tolerada, algoritmo **fijado** (RS256) y **JWKS de Google bajo caché** (`createRemoteJWKSet` — jose ya fetchea y cachea las claves), nonce validado si GIS lo incluye. El claim `email_verified` de Google se confía (sus emails están verificados por Google) y **debe ser `true`**: si no viene o es `false` → `401 EMAIL_NOT_VERIFIED` (ver US-07 AC-04); se guarda en la columna dedicada. **Anti-replay (nonce) — implementado (31-ago-2026)**: el cliente genera un nonce de alta entropía y lo usa al solicitar el ID token; el body de `/auth/google` lo envía en `GoogleRequest.nonce` (opcional en el schema, obligatorio en la práctica si el JWT lo incluye). El verifier compara el claim `nonce` del JWT contra ese `expectedNonce` del body — si el JWT trae nonce y no coincide → 401 `UNAUTHORIZED`. **El nonce NO se persiste ni se propaga a los claims**: es un dato efímero de la transacción de login (anti-replay en el momento del intercambio); la sesión posterior usa nuestros access/refresh tokens con su propio mecanismo de reuso.
45. **Modelo de datos — decidido: `users` con columnas nullable**: `id uuid PK`, `email TEXT UNIQUE NOT NULL`, `password_hash TEXT NULL`, `google_sub TEXT NULL`, `email_verified BOOLEAN`, `created_at`. Constraint CHECK: al menos uno de (`password_hash`, `google_sub`) presente **o email ya verificado** (`email_verified = 1` — apertura al acceso por magic link, nº 55). Cuando `google_sub` es NOT NULL → `email_verified = 1`. Login local busca por `email + password_hash`; login Google busca por `google_sub` (fallback por email solo para vincular en un futuro, nunca automático).
46. **Política de colisión de identidades — decidido: sin auto-linking**: si un usuario local ya existe con el mismo email y llega un ID token de Google con ese email → **409 código específico de proveedor** (`ACCOUNT_EXISTS_WITH_GOOGLE` si el email ya pertenece a un usuario solo-Google — el cliente sugiere "entrar con Google"; `EMAIL_ALREADY_EXISTS` si el email ya pertenece a un usuario solo-local — el cliente sugiere "usar email y contraseña"; ver US-08 AC-01/AC-02). **No** se vincula cuentas automáticamente (vector de account takeover cuando el email no está verificado); el linking explícito queda fuera de alcance y documentado para el futuro. El login por password mantiene el mensaje genérico (anti-enumeración).
47. **Sesiones y refresh con proveedor mixto**: los refresh tokens de usuarios Google usan **nuestros** (misma tabla `refresh_tokens`, rotación y detección de reuso de la nº 38). **No** se pide ni usa el refresh token de Google (scopes offline) — solo el ID token de identidad. El `userId` autenticado es el mismo `users.id` sin importar el proveedor → los endpoints protegidos no distinguen origen. Opcional por sesión: registrar el proveedor (`local|google|magic`) en `refresh_tokens` para trazabilidad (las sesiones emitidas al consumir un magic link se registran como `magic`).

## 9. Seguridad general

48. **helmet** (headers de seguridad), **CORS con allowlist** (nunca `*` si hay cookies), `trust proxy` correcto si hay reverse proxy.
49. Rate limiting global moderado + más agresivo en auth. Prepared statements en todo SQL. Secrets solo por env validado; `kid` para rotar secretos JWT.
50. Logs sin datos sensibles (ver sección «Logger» — redact y serializadores). Complementar con OWASP NodeJS Security Cheat Sheet como checklist.

## 10. Testing y calidad

51. **Vitest 4 como runner default** (384M/mes vs 196M de Jest, en descenso): ESM nativo, más rápido, mejor DX con TS. Supertest para integración HTTP. Alternativa cero-dep: **`node:test`** (viene con Node; con type-stripping funciona directo).
52. **Qué testear**: casos de uso (unit, con repos/hasher falsos) → integración de rutas con SQLite en **archivo temporal** (`:memory:` no respeta WAL) → E2E del flujo completo signup→login→refresh. Los tests de contrato (fase de implementación del SDD) validan que la respuesta real cumpla el OpenAPI.
53. **ESLint 10 + typescript-eslint (o Biome 2)**: ESLint domina (660M/mes); Biome gana tracción pero adopción aún marginal. ESLint es la opción segura. Reglas del equipo: prohíben `console.log` (se usa pino) y `any`/`@ts-ignore`.
54. **CI mínimo**: typecheck + lint + test + `npm audit`.
55. **Magic link (sign in sin contraseña) — implementado (3-sep-2026)**: acceso por enlace con **token opaco ≥ 32 bytes** (`randomBytes(32).base64url`) persistido solo como **hash SHA-256** en la tabla `magic_links` (un leak de BD no expone enlaces utilizables). **Auto-cuenta**: el request genera/persiste/envía el link **siempre** (exista o no el email) — es lo que habilita el alta implícita en el consumo y evita un side-channel temporal; la respuesta `200 { ok: true }` es idéntica en ambos casos (anti-enumeración). **Consumo**: `findByTokenHash(sha256(token))`, solo `status = 'pending'` y no vencido; tras validar, se marca `used` (**un solo uso** de nuevo → 401 `MAGIC_LINK_INVALID`, idéntico a inexistente/vencido). Email no registrado → **auto-cuenta** (`provider = 'magic'`, `email_verified = 1`, habilitado por la CHECK ampliada del nº 45); email registrado → se marca `email_verified = 1` y se emite sesión. TTL corto configurable (`MAGIC_LINK_TTL_MINUTES`, default 15, máx 60). El envío va tras el puerto `EmailSender` (adapters: consola en dev, SMTP en prod) y el endpoint está bajo rate limit. Documentado en US-09/10 (doc 01), diagrama 6 (doc 02), contrato (doc 03) y modelo `magic_links` (doc 04).
56. **Cambio y recuperación de contraseña (US-11/12) — implementado (5-sep-2026)**: reutiliza el canal magic link con un **intent** por request: `{ email, intent: 'login' | 'password_reset' }` (default `login`), persistido como `purpose` en `magic_links` (doc 04 → decisión 8; migración 0002 con `DEFAULT 'login'` retrocompatible — las filas copiadas heredan el canal de sesión). La URL de consumo la resuelve el intent en el handler (base pública = `PUBLIC_API_ORIGIN` + `API_PREFIX` — único origin configurado, compuesto en config, jamás derivado del Host header del request, anti-poisoning). **`POST /auth/change-password`** (autenticado, Bearer): `currentPassword` + `newPassword`; verifica el secreto actual → 401 `INVALID_CREDENTIALS` genérico (anti-enumeración, misma semántica que el login); cuenta sin `password_hash` (solo-Google/solo-magic) → **409, nuevo código `ACCOUNT_HAS_NO_PASSWORD`**; éxito → 204 y **revoca TODAS las sesiones** (`revokeFamily`, F1). **`POST /auth/password/reset`** (solo `authLimiter` — el token ES la credencial): consume un enlace `purpose = 'password_reset'`, **NO emite sesión** (204; el frontend redirige al login); reemplaza (o **asigna**, F2 auto-cuenta local con `email_verified = 1`) la contraseña; 401 `MAGIC_LINK_INVALID` idéntico para inexistente/vencido/usado/propósito equivocado (**F3**: un enlace de login no sirve para reset ni un enlace de reset crea sesión); **F1**: derriba todas las sesiones. Decisiones F1/F2/F3 aprobadas en planificación; 18 tests nuevos (`changePassword.test.ts` 7 + `passwordReset.test.ts` 11 — 74 total).

---

## 11. Evidencia verificada (27-ago-2026)

| Pieza | Versión actual | Última publicación |
|---|---|---|
| Node LTS | **v24.20.0 "Krypton"** | Active LTS |
| express | 5.2.1 | dic-2025 |
| jose | 6.2.10 | ago-2026 |
| jsonwebtoken | 9.0.3 | dic-2025 |
| **passport** | 0.7.0 | **nov-2023** |
| **passport-jwt** | 4.0.1 | **dic-2022** |
| argon2 | 0.45.1 | jul-2026 |
| bcrypt | 6.0.0 | may-2025 |
| better-sqlite3 | 13.0.3 | ago-2026 |
| drizzle-orm | 0.45.2 | mar-2026 |
| prisma | 8.0.0-rc.12 | ago-2026 |
| zod | 4.4.3 | may-2026 |
| pino | 10.3.1 | feb-2026 |
| vitest | 4.1.11 | ago-2026 |
| typescript | **7.0.2** | jul-2026 |
| `node:sqlite` | — | **Stability 1.2 (Release candidate)** en docs v26 |

Descargas/mes (npm): zod 1.09B · eslint 660M · jose 473M · vitest 384M · jsonwebtoken 232M · jest 196M · drizzle 77M · prisma 68M · better-sqlite3 39.6M · passport 33.8M · bcrypt 24M · knex 21.6M · argon2 8.4M

---

## 12. Decisiones tomadas (27-ago-2026)

| # | Decisión | Detalle |
|---|---|---|
| 1 | **argon2 (argon2id)** | Se descarta bcrypt. Adapter `PasswordHasher` → argon2 (ver nº 35). |
| 2 | **jose + middleware propio** | Se descarta passport. Verificación con `jose.jwtVerify` tras `TokenService` (ver nº 36–37). |
| 3 | **Estructura por capas** | `src/{domain,application,infrastructure,presentation}` (ver nº 28). |
| 4 | **Drizzle ORM** | Con driver better-sqlite3 sobre node:sqlite/better-sqlite3 (ver nº 33). |
| 5 | **Google OIDC: GIS token flow + jose** | Sin dependencias nuevas; verificación JWKS estrictamente server-side (ver nº 43–44). |
| 6 | **Modelo de identidades: `users` nullable** | `password_hash NULL` + `google_sub NULL`, CHECK ≥ 1 (ver nº 45). Sin auto-linking de cuentas (ver nº 46). |
| 7 | **Value Objects con Zod 4 (branded)** | Semánticas tipadas en `src/domain/value-objects/`: `Email`, `UserId`, `PasswordHash`, `Provider`, `GoogleSub`… El schema zod ES el tipo del VO (ver sección 6.1). |
| 8 | **Cambio/reset de contraseña sobre el canal magic link (5-sep-2026)** | `intent` en el request → `purpose` en `magic_links`; el reset no emite sesión (204) y ambos flujos revocan todas las sesiones (F1); nuevo error `ACCOUNT_HAS_NO_PASSWORD` → 409 (ver nº 56, US-11/12). |

**Stack final**: Node 24 LTS · TypeScript 7 · Express 5 · Clean Architecture (por capas) · SQLite (better-sqlite3) · Drizzle · JWT (jose) · UUID nativo · argon2id · OIDC Google (GIS + jose) · pino · Zod 4 · Vitest 4