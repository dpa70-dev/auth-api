# 01 · Historias de Usuario y Criterios de Aceptación — API Signup/Login

**Estado**: Fase 2 de Spec Driven Development (contrato OpenAPI en `03-openapi.yaml`) — historias completadas como entrada de la especificación (doc 03) y de la implementación (fase 3, resuelta: 74 tests e2e en verde, ver `test/e2e.test.ts`, `test/magicLink.test.ts`, `test/changePassword.test.ts` y `test/passwordReset.test.ts`).
**Alcance**: registro local y login con email/contraseña, login con Google (OIDC), **acceso por magic link sin contraseña (US-09/10)**, **cambio de contraseña (US-11)** y **recuperación de contraseña por email (US-12)**, colisión de identidades entre proveedores, logout, refresco de tokens y acceso a recursos protegidos de una API REST.

---

## Convenciones transversales

- **Envelope de respuesta**: éxito → `{ "data": ... }` · error → `{ "error": { "code", "message", "details" } }`.
- **Semántica de códigos HTTP**:
  - `400` — payload/json malformado o header inválido.
  - `401` — no autenticado / credenciales inválidas / token ausente, vencido, malformado o con firma no verificada.
  - `409` — conflicto de estado (email ya registrado; con indicación del proveedor: `EMAIL_ALREADY_EXISTS` para local, `ACCOUNT_EXISTS_WITH_GOOGLE` para Google).
  - `422` — falla de validación de negocio (schema zod): campos faltantes, formatos o restricciones.
  - `429` — rate limit excedido.
  - `500` — error no esperado; jamás exponer detalles internos ni stack traces.
- **Identificador de usuario**: UUID v4 único (`crypto.randomUUID()`), nunca expuesto como clave autoincremental.
- **Contraseñas** (NIST 800-63B): mínimo 8 caracteres, ideal ≥ 15; máximo 64; **sin** reglas de complejidad obligatorias (sin exigir mayúsculas/símbolos); almacenadas solo como hash **argon2id**, nunca en texto plano ni en logs.
- **Errores de autenticación**: mensajes genéricos e idénticos entre "email inexistente" y "contraseña incorrecta" (anti-enumeración).

---

## US-01 · Registro de usuario

**Como** usuario nuevo, **quiero** registrarme con email y contraseña, **para** crear una cuenta y poder autenticarme en la API.

**Criterios de aceptación:**

- **AC-01** — Dado un payload válido (`email`, `password`), cuando hago `POST /auth/register`, entonces obtengo `201 Created`, el usuario se persiste y la respuesta es `{ data: SignupResponse }`.
- **AC-02** — `SignupResponse` contiene: `accessToken`, `refreshToken` y `user` con `{ id: UUID, email, createdAt }`. **No** incluye hash, ni campos internos de la entidad.
- **AC-03** — El email se normaliza a minúsculas y se valida con formato estándar; el email ya existente en base → `409 Conflict` con `code: EMAIL_ALREADY_EXISTS`.
- **AC-04** — Contraseña validada según convención NIST (mín. 8, máx. 64); contraseña fuera de rango o email malformado → `422` con `details` listando cada campo y su problema.
- **AC-05** — El usuario se guarda con `id` UUID v4, `email` único (índice), `passwordHash` (propiedad de entidad, nunca el texto plano; en la DB la columna es `password_hash`, ver doc 00 → nº 45) y `createdAt`.
- **AC-06** — Dos registros simultáneos con el mismo email → exactamente uno obtiene `201`; el otro `409` (unicidad garantizada a nivel de base de datos, no solo por validación previa).
- **AC-07** — Intentos repetidos desde la misma IP quedan sujetos a rate limit → `429`.

**Notas para la especificación (fase 2)**: `POST /api/v1/auth/register` · body `{ email, password }` · respuestas 201/400/409/422/429.

---

## US-02 · Login

**Como** usuario registrado, **quiero** iniciar sesión con email y contraseña, **para** obtener mis tokens de acceso y refresco.

**Criterios de aceptación:**

- **AC-01** — Dado un usuario existente con credenciales correctas, cuando hago `POST /auth/login`, entonces obtengo `200 OK` con `{ data: { accessToken, refreshToken, user } }`.
- **AC-02** — Credenciales incorrectas (email inexistente **o** contraseña equivocada) → `401` con idéntico mensaje genérico (`code: INVALID_CREDENTIALS`), sin revelar cuál de los dos falló.
- **AC-03** — El tiempo de respuesta no delata si el email existe: al fallar con email inexistente se compara contra un hash ficticio (misma operación de hashing) para igualar el tiempo de la verificación.
- **AC-04** — El endpoint está sujeto a rate limiting por IP (y por email) → al exceder el umbral, `429` con `Retry-After`.
- **AC-05** — `user` en la respuesta no incluye el hash; solo `{ id, email, createdAt }`.
- **AC-06** — Payload inválido (campos faltantes/malformados) → `422`, sin ejecutar la verificación de credenciales.

**Notas para la especificación (fase 2)**: `POST /api/v1/auth/login` · body `{ email, password }` · respuestas 200/400/401/422/429.

---

## US-03 · Refresco de tokens

**Como** cliente de la API con un `accessToken` vencido, **quiero** intercambiar mi `refreshToken` por un par nuevo, **para** mantener la sesión sin volver a escribir mis credenciales.

**Criterios de aceptación:**

- **AC-01** — Dado un `refreshToken` válido y vigente, cuando hago `POST /auth/refresh`, entonces obtengo `200 OK` con un **par nuevo** de tokens (`accessToken` + `refreshToken`).
- **AC-02** — **Rotación**: cada refresh invalida el refresh usado (se marca como usado/reemplazado en base). El mismo refresh presentado dos veces NO funciona.
- **AC-03** — **Detección de reuso**: presentar un refresh ya usado → `401` **y** revocación de toda la familia de tokens del usuario (todos sus refresh activos quedan invalidados).
- **AC-04** — Refresh vencido, revocado, inexistente o con firma inválida → `401` con mensaje genérico.
- **AC-05** — El refresh que el servidor guarda en base es el **hash** del token (SHA-256), nunca el token en claro (un leak de la DB no expone refresh utilizables).
- **AC-06** — Endpoint con rate limit → `429` al exceder el umbral.

**Notas para la especificación (fase 2)**: `POST /api/v1/auth/refresh` · body `{ refreshToken }` · respuestas 200/400/401/422/429.

---

## US-04 · Logout

**Como** usuario autenticado, **quiero** cerrar sesión, **para** que mi `refreshToken` quede revocado y no pueda volver a usarse.

**Criterios de aceptación:**

- **AC-01** — Dado un usuario autenticado, cuando hago `POST /auth/logout` con su `refreshToken`, entonces obtengo `204 No Content` y el refresh queda revocado en base.
- **AC-02** — Presentar un refresh ya revocado después del logout → `401` (reuso detectado → se revoca toda la familia).
- **AC-03** — Logout sin token o con token inválido → `401` (o `400` si el body no viene; según semántica transversal: token ausente = `401`).
- **AC-04** — El `accessToken` vigente no se revoca explícitamente: expira solo por su corta vida (5–15 min). Documentado como comportamiento esperado.

**Notas para la especificación (fase 2)**: `POST /api/v1/auth/logout` · body `{ refreshToken }` · respuestas 204/400/401/422.

---

## US-05 · Acceso a recurso protegido

**Como** usuario autenticado, **quiero** que exista un recurso protegido (`GET /auth/me`), **para** poder validar mis tokens y consultar mis propios datos.

**Criterios de aceptación:**

- **AC-01** — Dado un `Bearer` token válido y vigente, cuando hago `GET /auth/me`, entonces obtengo `200 OK` con `{ data: { id, email, createdAt } }`.
- **AC-02** — Sin header `Authorization`, header malformado, token malformado, vencido, o con firma inválida → `401`, respuesta idéntica en forma para todos los casos (sin revelar la causa exacta).
- **AC-03** — Token firmado con algoritmo distinto al configurado (p. ej. `none` o `HS384` cuando se espera `HS256`) → `401` (el algoritmo de verificación está **fijado en el código**, nunca tomado del header `alg`).
- **AC-04** — El recurso `me` devuelve únicamente los datos del usuario autenticado; nunca datos de otro usuario (ID del token, no del request).

**Notas para la especificación (fase 2)**: `GET /api/v1/auth/me` · header `Authorization: Bearer <accessToken>` · respuestas 200/401.

---

## US-06 · Errores consistentes y accionables

**Como** consumidor de la API, **quiero** recibir errores con formato uniforme y mensajes accionables, **para** integrarme y diagnosticar sin ambigüedad.

**Criterios de aceptación:**

- **AC-01** — Todo error sigue el envelope `{ error: { code, message, details } }`, donde `code` es un identificador estable programable (`INVALID_CREDENTIALS`, `EMAIL_ALREADY_EXISTS`, `ACCOUNT_EXISTS_WITH_GOOGLE`, `EMAIL_NOT_VERIFIED`, `VALIDATION_ERROR`, `RATE_LIMITED`, …).
- **AC-02** — `message` es legible por humanos; `details` es opcional y estructura los errores de validación por campo (`[{ field: "email", issue: "invalid_email" }]`).
- **AC-03** — Los errores `5xx` jamás exponen stack traces, rutas internas ni valores sensibles.
- **AC-04** — Cada respuesta de error incluye `requestId` (correlación con los logs estructurados de pino) para soporte.

**Notas**: esta historia es transversal; se satisface en la fase de implementación con el middleware de error centralizado y el envelope único (ver doc `00-consideraciones-tecnicas.md` → «Manejo centralizado de errores y respuestas (400/500)»). El `requestId` de AC-04 lo genera y propaga pino-http (ver doc 00 → «Logger»): los errores 400 (parse) y 500 (inesperados) se normalizan en ese mismo middleware con el envelope de AC-01.

---

## US-07 · Iniciar sesión con Google

**Como** usuario con cuenta de Google, **quiero** iniciar sesión con "Sign in with Google", **para** no tener que recordar otra contraseña.

**Criterios de aceptación:**

- **AC-01** — Dado un ID token de Google válido (emitido por `accounts.google.com`, `aud` = client_id configurado, no vencido), cuando hago `POST /auth/google` con `{ idToken }`, entonces obtengo `200 OK` con `{ data: { accessToken, refreshToken, user } }`.
- **AC-02** — Si el `google_sub` no existe en `users`, se crea el usuario (email de Google, sin contraseña, `email_verified = 1`) y se responde `200` con el par de tokens (primer inicio = alta implícita).
- **AC-03** — Verificación **estrictamente server-side** con jose (JWKS de Google en caché): token con `aud` distinto al client_id configurado → `401`; firma no verificable con el JWKS o algoritmo ≠ RS256 → `401`; vencido → `401`. El server jamás confía en el payload sin verificar.
- **AC-04** — El claim `email_verified` debe ser `true`; si no viene o es `false` → `401` (`EMAIL_NOT_VERIFIED`). El server sí confía en el `email` del claim solo cuando está verificado.
- **AC-05** — La respuesta usa el mismo envelope y forma que `/auth/login` (mismo contrato de `user`): el cliente no distingue el proveedor al consumir la sesión.
- **AC-06** — El endpoint acepta solo JSON (sin cookies) → sin CSRF clásico; CORS con allowlist. Rate limiting igual que `/login` → `429`.

**Notas para la especificación (fase 2)**: `POST /api/v1/auth/google` · body `{ idToken }` · respuestas 200/400/401/422/429. El ID token viaja en el body, NO como `Authorization`.

---

## US-08 · Colisión de identidades (local vs Google)

**Como** usuario, cuando intento autenticarme y mi email ya está registrado con otro método, **quiero** recibir un error claro y específico, **para** saber qué método usar — sin que el sistema exponga datos de otros usuarios.

**Criterios de aceptación:**

- **AC-01** — Registro local (`POST /auth/register`) con email que ya existe como usuario solo-Google → `409` con `code: ACCOUNT_EXISTS_WITH_GOOGLE` (el cliente muestra "usá Google para entrar").
- **AC-02** — Login con Google (`POST /auth/google`) con email que ya existe como usuario solo-local → `409` con `code: EMAIL_ALREADY_EXISTS` (el cliente muestra "usá email y contraseña").
- **AC-03** — **Nunca se vinculan cuentas automáticamente**: cada alta crea el usuario con una sola identidad (local o Google). El account linking explícito queda fuera de alcance.
- **AC-04** — En el login por password (US-02) la colisión **no** se revela: mensaje genérico `401` (`INVALID_CREDENTIALS`) — anti-enumeración. Solo el registro (local/Google) orienta con el código específico, porque es una acción donde el propio usuario inicia exponiendo su email.
- **AC-05** — El detalle del error incluye el proveedor sugerido (`details: [{ field: "provider", issue: "google" }]`) sin datos del otro usuario (ni su id, ni su createdAt).

**Notas para la especificación (fase 2)**: aplica a `POST /auth/register` y `POST /auth/google` · respuestas 409 con códigos estables.

---

## US-09 · Solicitar magic link (sign in sin contraseña)

**Como** usuario, **quiero** recibir un enlace mágico por email, **para** iniciar sesión sin recordar una contraseña.

**Criterios de aceptación:**

- **AC-01** — Dado un email válido, cuando hago `POST /auth/magic-link/request` con `{ email }`, entonces obtengo `200 OK` con `{ data: { ok: true } }` y, si el email está registrado, se persiste un token y se envía un email con la URL de consumo `?token=<opaco>`.
- **AC-02** — **Anti-enumeración**: la respuesta `200 { ok: true }` es **idéntica** exista o no el email, y se realiza la **misma cantidad de trabajo** (generar token, persistir hash, enviar email) en ambos casos — así el atacante no distingue por la respuesta ni por side-channel temporal si una cuenta está registrada.
- **AC-03** — El token opaco es aleatorio (≥ 32 bytes) y el servidor persiste solo su **hash** SHA-256, nunca el token en claro (un leak de la DB no expone links utilizables).
- **AC-04** — El enlace expira tras un TTL corto configurable (default 15 min, máx 60; env `MAGIC_LINK_TTL_MINUTES`).
- **AC-05** — Email inválido/malformado → `422` con `details` indicando el campo.
- **AC-06** — Endpoint bajo rate limit → `429` al exceder el umbral.

**Notas para la especificación (fase 2)**: `POST /api/v1/auth/magic-link/request` · body `{ email }` · respuestas 200/400/422/429.

---

## US-10 · Consumir magic link (login por enlace)

**Como** usuario con un magic link en mi email, **quiero** abrirlo, **para** quedar autenticado con una sesión de tokens.

**Criterios de aceptación:**

- **AC-01** — Dado un token válido y vigente (`pending`, no vencido), cuando hago `POST /auth/magic-link/consume` con `{ token }`, entonces obtengo `200 OK` con `{ data: { accessToken, refreshToken, user } }` (misma forma que `/login` — el cliente no distingue el proveedor).
- **AC-02** — **Auto-cuenta**: si el email del link no está registrado, se **crea** el usuario (`provider = 'magic'`, `email_verified = 1`) y se responde `200` con el par de tokens (primer consumo = alta implícita).
- **AC-03** — Si el email ya está registrado (local o Google), se marca `email_verified = 1` y se emite sesión sobre la cuenta existente (probar posesión del email no crea una identidad duplicada).
- **AC-04** — **Un solo uso**: el token se marca `used` al consumirse; presentarlo de nuevo → `401` (`MAGIC_LINK_INVALID`).
- **AC-05** — Token inexistente, revocado o vencido → `401` `MAGIC_LINK_INVALID`, respuesta idéntica en forma para todos los casos (anti-enumeración).
- **AC-06** — El access token emitido funciona en los endpoints protegidos (`/auth/me`), igual que cualquier otra sesión.

**Notas para la especificación (fase 2)**: `POST /api/v1/auth/magic-link/consume` · body `{ token }` · respuestas 200/400/401/422/429.

---

## US-11 · Cambio de contraseña

**Como** usuario autenticado con contraseña local, **quiero** cambiarla probando la actual, **para** proteger mi cuenta si el secreto se filtró.

**Criterios de aceptación:**

- **AC-01** — Dado un usuario autenticado (Bearer válido), cuando hago `POST /auth/change-password` con `{ currentPassword, newPassword }` válidos, entonces obtengo `204 No Content` y el hash nuevo queda persistido.
- **AC-02** — **F1 (revocación total)**: el cambio revoca TODAS las sesiones del usuario; los refresh anteriores dejan de funcionar y el cliente re-autentica. El access vigente no se revoca explícitamente (expira en 5-15 min, comportamiento esperado).
- **AC-03** — Contraseña actual incorrecta → `401` `INVALID_CREDENTIALS` genérico (misma semántica que US-02) con log del intento fallido.
- **AC-04** — Cuenta sin contraseña local configurada (solo-Google o solo-magic, `password_hash = NULL`) → `409` `ACCOUNT_HAS_NO_PASSWORD` (no hay secreto actual que probar).
- **AC-05** — `newPassword` fuera de las reglas NIST (mín. 8, máx. 64) → `422` con `details` por campo; el endpoint está bajo el rate limit de auth → `429`.
- **AC-06** — Sin token o token inválido → `401` `UNAUTHORIZED` (guarda `requireAuth`).

**Notas para la especificación (fase 2)**: `POST /api/v1/auth/change-password` · body `{ currentPassword, newPassword }` · header `Authorization: Bearer` · respuestas 204/400/401/409/422/429/500.

---

## US-12 · Recuperación de contraseña (olvidé mi contraseña)

**Como** usuario que olvidó su contraseña, **quiero** recibir un enlace por email que me permita definir una nueva, **para** recuperar el acceso a mi cuenta.

**Criterios de aceptación:**

- **AC-01** — Dado un email válido, cuando hago `POST /auth/magic-link/request` con `{ email, intent: 'password_reset' }`, entonces obtengo `200 { data: { ok: true } }` **idéntico** exista o no el email (anti-enumeración: misma forma y misma cantidad de trabajo que US-09), y se envía un email con la URL `MAGIC_LINK_PASSWORD_RESET_CONSUME_BASE_URL?token=<opaco>`.
- **AC-02** — Con ese token (no vencido, `purpose = 'password_reset'`), cuando hago `POST /auth/password/reset` con `{ token, password }`, entonces obtengo `204 No Content`. **NO se emite sesión**: el cliente redirige al login con el secreto nuevo.
- **AC-03** — **F1**: el reset revoca TODAS las sesiones del usuario (misma política que US-11 AC-02).
- **AC-04** — **F2**: email aún no registrado → se crea una auto-cuenta local (`email_verified = 1`, el enlace prueba la posesión del email, coherente con US-10 AC-02) y se asigna la contraseña; el usuario puede loguear de inmediato.
- **AC-05** — **F3 (separación de canales)**: un enlace emitido con `intent: 'login'` presentado en el reset → `401` `MAGIC_LINK_INVALID`; un enlace de `password_reset` presentado en `/auth/magic-link/consume` → el mismo `401` idéntico.
- **AC-06** — Token inexistente, vencido o ya usado → `401` `MAGIC_LINK_INVALID` idéntico en forma (anti-enumeración + un solo uso, patrón US-10 AC-04/AC-05).
- **AC-07** — `password` fuera de las reglas NIST → `422`; el endpoint está bajo el rate limit de auth → `429`.

**Notas para la especificación (fase 2)**: `POST /api/v1/auth/password/reset` · body `{ token, password }` · respuestas 204/400/401/422/429/500. El token ES la credencial: la ruta lleva solo `authLimiter` (sin `requireAuth`).

---

## Fuera de alcance (para fases futuras)

- ~~Verificación de email~~ — **resuelto con magic link (US-09/10)**: emails locales se verifican al consumir un enlace (`email_verified = 1`); sigue aplicando que los de Google vienen verificados por OIDC.
- **Vincular cuentas locales con cuentas Google (account linking)** — política actual: sin auto-linking (ver doc `00-consideraciones-tecnicas.md` → nº 46).
- ~~Recuperación / reset de contraseña~~ — **resuelto con magic link de propósito `password_reset` (US-12)**: reutiliza el canal de enlaces mágicos (US-09/10) con un `intent`/`purpose` propio; sin tabla ni flujo alternativo.
- 2FA / MFA.
- Roles, permisos y autorización por recurso (el nombre del proyecto sugiere `rol` — se modelará en una iteración posterior).
- Gestión multi-dispositivo / listado de sesiones activas.
- Entrega de tokens vía cookie httpOnly — decidido: header `Authorization: Bearer` por defecto en este ejemplo (ver doc 00 → nº 39, trade-off documentado).
- Revocación global / blocklist de access tokens (no necesaria con expiración corta).

---

## Próximos pasos (fase 2, pendiente de confirmación)

1. *(Resuelto el 27-ago-2026)*: **especificación OpenAPI 3.1** en `docs/03-openapi.yaml` (paths, schemas, security schemes, ejemplos). Validada con `@redocly/cli` (0 errores) y parseada con `openapi-typescript`.
2. *(Resuelto el 27-ago-2026)*: argon2id · jose + middleware propio · estructura por capas · Drizzle · **Google OIDC (GIS token flow + jose; modelo `users` nullable)**. No quedan opciones abiertas → la especificación partió directo de estas historias.
3. *(Resuelto el 29-ago-2026)*: **modelo de datos** en `docs/04-modelo-de-datos.md` (ERD + DDL `users`/`refresh_tokens`, trazabilidad columna→fuente) y **auditoría de fidelidad** de los flujos en `docs/02-flujos-registro-autenticacion.md` (logout = soft-revoke para satisfacer AC-02, ramas 429 en /refresh y /google, notas Google-only y token opaco).
4. *(Resuelto el 29-ago-2026)*: **implementación contra el contrato (SDD)** con `openapi-typescript` (tipos derivados del contrato) y contract tests.
5. *(Resuelto el 3-sep-2026)*: **magic link (US-09/10)** — contrato (doc 03), modelo `magic_links` (doc 04), diagrama 6 (doc 02), consideraciones nº 55 (doc 00) e implementación completa con 10 tests nuevos en `test/magicLink.test.ts` (56 total).
6. *(Resuelto el 5-sep-2026)*: **cambio y recuperación de contraseña (US-11/12)** — `intent`/`purpose` en el contrato (doc 03), columna `magic_links.purpose` (doc 04), flujo de reset en el diagrama 6 (doc 02), consideración nº 56 (doc 00) e implementación con 18 tests nuevos en `test/changePassword.test.ts` (7) y `test/passwordReset.test.ts` (11) — **74 total**.