# 02 · Flujos de Registro y Autenticación — Representación Gráfica

**Estado**: Fase 2 de Spec Driven Development — representación gráfica de `01-historias-de-usuario.md`, auditada contra el contrato OpenAPI (`03-openapi.yaml`) y el modelo de datos (`04-modelo-de-datos.md`). **Implementada y verificada en la fase 3 (29-ago-2026 → 5-sep-2026)**: cada flujo de este documento tiene su test e2e en `test/e2e.test.ts`, `test/magicLink.test.ts`, `test/changePassword.test.ts` y `test/passwordReset.test.ts` (US-01..12, 74 tests en verde).
**Fuente**: historias US-01 a US-10 y consideraciones `00-consideraciones-tecnicas.md` (ítems 16-24 errores, 35 hashing, 36-38 tokens, 41-42 hardening/logout, 43-47 Google OIDC, 50-52 magic link).
**Cómo leer**: cada diagrama es un proceso completo con sus caminos de éxito y error; las respuestas de error siguen siempre el envelope `{ error: { code, message, details? } }` con `requestId` (doc 00 → ítems 20-21); las de éxito, `{ data: ... }`.

## 0. Leyenda de participantes

| Alias | Rol |
|---|---|
| `C` | Cliente (SPA/web o móvil/CLI) que consume la API |
| `P` | Presentación — rutas/controllers (capa delgada) |
| `A` | Aplicación — caso de uso (lógica de negocio) |
| `T` | Infraestructura — `TokenService` (emisión/verificación jose) |
| `H` | Infraestructura — `PasswordHasher` (argon2id) |
| `R` | Infraestructura — `UserRepository` (acceso a datos) |
| `M` | Infraestructura — `MagicLinkRepository` (acceso a datos de `magic_links`) |
| `E` | Infraestructura — `EmailSender` (envío de magic links) |
| `DB` | SQLite (better-sqlite3 + Drizzle) |
| `GIS` | Google Identity Services — "Sign in with Google" (lado cliente) |
| `JWKS` | JSON Web Key Set de Google (`accounts.google.com/.well-known/jwks.json`) — claves públicas de firma |

Reglas transversales que aplican a todos los diagramas (doc 00 → ítems 16-24, 41, 48-49):

- `400` = JSON/header malformado · `401` = no autenticado (mensaje genérico) · `409` = conflicto de identidad · `422` = validación zod con `details` por campo · `429` = rate limit · `500` = genérico con `requestId`.
- Rate limiting en `/register`, `/login`, `/refresh`, `/google` y `/auth/magic-link/*` (más agresivo que el global); `429` con `Retry-After`.
- El access token dura 5-15 min (HS256, algoritmo fijado); el refresh 7-30 días, guardado **hasheado** (SHA-256) con su `jti` y rotado en cada uso.
- El magic link es un token **opaco** (≥ 32 bytes aleatorios) persistido solo como **hash** SHA-256, con TTL corto y un solo uso.

---

## 1. Registro local — US-01 (+ colisión US-08)

```mermaid
sequenceDiagram
    participant C as Cliente
    participant P as Presentación
    participant A as Aplicación · RegisterUser
    participant H as PasswordHasher
    participant R as UserRepository
    participant DB as SQLite
    participant T as TokenService

    C->>P: POST /api/v1/auth/register { email, password }
    P->>P: Parse body · schemas zod compuestos de VOs (Email, PlainPassword)

    alt JSON malformado o header inválido
        P-->>C: 400 MALFORMED_REQUEST { error: { code, message, requestId } }
    else Validación falla (formato/longitud)
        P-->>C: 422 VALIDATION_ERROR { details: [{ field, issue }] }
    else Rate limit excedido
        P-->>C: 429 RATE_LIMITED (Retry-After: n)
    else Payload válido
        P->>A: RegisterUser(emailNormalizado, plainPassword)
        A->>R: findByEmail(email)
        R->>DB: SELECT ... FROM users WHERE email = ?
        DB-->>R: fila | null

        alt Email ya registrado
            alt El email pertenece a un usuario solo-Google
                A-->>C: 409 ACCOUNT_EXISTS_WITH_GOOGLE — details: [{ field: "provider", issue: "google" }] (US-08 AC-01/AC-05, sin auto-linking)
            else El email pertenece a un usuario local
                A-->>C: 409 EMAIL_ALREADY_EXISTS — details: [{ field: "provider", issue: "local" }]
            end
        else Email libre
            A->>H: hash(plainPassword)
            H-->>A: PasswordHash (argon2id, salt único, m=19456 t=2 p=1)
            Note over A,R: Alta: id UUID v4, email único, password_hash, email_verified=false (local)
            A->>R: save(user)
            R->>DB: INSERT INTO users (...)
            A->>T: emitirPar(user.id)
            T-->>A: accessToken (HS256, 5-15 min) + refreshToken (jti, 7-30 días)
            A-->>C: 201 { data: { accessToken, refreshToken, user: { id, email, createdAt } } }
            Note over A,C: user NUNCA incluye password_hash (US-01 AC-02)
        end
    end
```

Notas:

- La unicidad del email está garantizada a nivel de BD (índice único), no solo por la validación previa: dos registros simultáneos → uno `201`, el otro `409` (US-01 AC-06).
- `422` precede a todo: payload inválido nunca llega al hashing ni a la BD (doc 00 → ítem 19).
- Cualquier error inesperado de infraestructura → `500 INTERNAL_ERROR` con `requestId` (doc 00 → ítem 20).

---

## 2. Login local — US-02

```mermaid
sequenceDiagram
    participant C as Cliente
    participant P as Presentación
    participant A as Aplicación · Login
    participant H as PasswordHasher
    participant R as UserRepository
    participant DB as SQLite
    participant T as TokenService

    C->>P: POST /api/v1/auth/login { email, password }
    P->>P: Parse body · schemas zod

    alt JSON/validación/rate limit
        P-->>C: 400 | 422 VALIDATION_ERROR | 429 RATE_LIMITED
    else Payload válido
        P->>A: Login(emailNormalizado, plainPassword)
        A->>R: findByEmail(email)
        R->>DB: SELECT ... WHERE email = ?

        alt Email NO existe (anti-enumeración)
            A->>H: verify(plainPassword, hashFicticio) — misma operación, tiempo constante
            H-->>A: false
            A-->>C: 401 INVALID_CREDENTIALS (mensaje idéntico, sin revelar que el email no existe)
        else Email existe
            A->>H: verify(plainPassword, user.password_hash)
            alt Verificación falla
                A-->>C: 401 INVALID_CREDENTIALS (mismo mensaje que el caso anterior)
            else Verificación correcta
                A->>T: emitirPar(user.id)
                T-->>A: accessToken + refreshToken
                A-->>C: 200 { data: { accessToken, refreshToken, user: { id, email, createdAt } } }
            end
        end
    end
```

Notas:

- Anti-enumeración (doc 00 → ítem 41, US-02 AC-02/AC-03): ambos caminos de fallo devuelven exactamente el mismo `401` y consumen un tiempo equivalente (verificación contra hash ficticio cuando el email no existe, comparación en tiempo constante de argon2id).
- `422` precede la verificación: payload inválido nunca ejecuta hashing ni consulta por email (US-02 AC-06). Rate limit por IP **y por email** (US-02 AC-04).
- El flujo de refresh de este login es el del diagrama 3; el de logout, el del diagrama 4.
- Usuario solo-Google (password_hash NULL) intentando login local → cae en «Verificación falla» → `401 INVALID_CREDENTIALS` genérico: la colisión no se revela en login (US-08 AC-04).

---

## 3. Refresco de tokens — US-03

```mermaid
sequenceDiagram
    participant C as Cliente
    participant P as Presentación
    participant A as Aplicación · RefreshTokens
    participant R as UserRepository
    participant DB as SQLite
    participant T as TokenService

    C->>P: POST /api/v1/auth/refresh { refreshToken }
    P->>A: RefreshTokens(refreshToken)
    A->>R: findByHash(sha256(refreshToken))
    R->>DB: SELECT ... FROM refresh_tokens WHERE token_hash = ?
    DB-->>R: fila | null

    alt Body malformado (sin refreshToken o JSON inválido)
        P-->>C: 400 | 422 VALIDATION_ERROR
    else Body válido pero rate limit excedido
        P-->>C: 429 RATE_LIMITED (Retry-After: n) — US-03 AC-06
    else No encontrado, vencido, revocado o con firma inválida
        A-->>C: 401 (mensaje genérico, sin revelar la causa)
    else Encontrado, pero ya usado (REUSO)
        Note over A,R: Detección de reuso: el mismo refresh presentado dos veces
        A->>R: revokeFamily(user.id) — se invalidan TODOS los refresh activos del usuario
        R->>DB: UPDATE refresh_tokens SET revocado = 1 WHERE user_id = ?
        A-->>C: 401 (mensaje genérico)
    else Válido y vigente (rotación)
        A->>R: marcarUsado(refreshToken) — rota el token anterior
        R->>DB: UPDATE refresh_tokens SET usado = 1 WHERE token_hash = ?
        A->>T: emitirPar(user.id)
        T-->>A: { accessToken, refreshToken } (par NUEVO)
        A-->>C: 200 { data: { accessToken, refreshToken } }
    end
```

Notas:

- Cada refresh consume el token: el par nuevo es el único usable a partir de entonces (US-03 AC-02).
- La BD guarda el hash SHA-256 del refresh, nunca el token en claro (doc 00 → ítem 38, US-03 AC-05): un leak de la DB no expone refresh utilizables.
- El reuso es el indicador de robo por excelencia: la respuesta es `401` genérico (el atacante no debe saber que detectamos el reuso) mientras se revoca toda la familia (US-03 AC-03).
- US-03 AC-04 menciona «firma inválida»: nuestro refresh es **opaco** (no-JWT, doc 00 → ítem 38), así que ese caso se interpreta como token ilegible/malformado/truncado — no hay firma que validar (doc 04).

---

## 4. Logout — US-04

```mermaid
sequenceDiagram
    participant C as Cliente
    participant P as Presentación
    participant A as Aplicación · Logout
    participant R as UserRepository
    participant DB as SQLite

    C->>P: POST /api/v1/auth/logout { refreshToken }

    alt Body malformado (JSON inválido o sin refreshToken)
        P-->>C: 400 | 422 VALIDATION_ERROR
    else Token presente y válido
        P->>A: Logout(refreshToken)
        A->>R: revoke(refreshToken)
        R->>DB: UPDATE refresh_tokens SET revocado = 1 WHERE token_hash = ? (soft-revoke)
        A-->>C: 204 No Content
    end

    Note over C,P: Si un refresh revocado se presenta después (p. ej. /refresh):
    Note over P,DB: Mismo camino del diagrama 3 → 401 + revocación de toda la familia (US-04 AC-02)
```

Notas:

- El access token vigente no se revoca explícitamente: expira solo por su corta vida (5-15 min); comportamiento documentado y esperado (US-04 AC-04, doc 00 → ítem 42).
- Logout sin token o con token inválido → `401` (token ausente = no autenticado, semántica transversal); body ausente → `400` (US-04 AC-03).
- **Soft-revoke y no `DELETE`**: si el refresh se borrara de la tabla, presentarlo después de un logout sería un token «inexistente» (camino AC-04) y NO podría disparar la revocación de familia que exige US-04 AC-02. Marcar `revocado = 1` conserva la fila y el reuso posterior recorre el diagrama 3 completo. El ítem 42 («borrarlo de DB») queda reconciliado como borrado lógico; mismo comportamiento para `usado` (rotación, diagrama 3) — ver `04-modelo-de-datos.md`.

---

## 5. Login con Google — US-07 (+ colisión US-08)

```mermaid
sequenceDiagram
    participant C as Cliente / SPA
    participant GIS as Google Identity Services
    participant P as Presentación
    participant J as jose · JWKS Google
    participant A as Aplicación · LoginGoogle
    participant R as UserRepository
    participant DB as SQLite
    participant T as TokenService

    C->>GIS: «Sign in with Google» (clic del usuario)
    GIS-->>C: ID token (JWT RS256 + claims: sub, email, email_verified, aud, iss, exp)

    C->>P: POST /api/v1/auth/google { idToken }
    P->>J: jwtVerify(idToken) — clave pública del JWKS de accounts.google.com (cacheada)
    J-->>P: claims verificados | error de verificación

    alt Payload inválido (idToken faltante o malformado)
        P-->>C: 400 | 422 VALIDATION_ERROR
    else Rate limit excedido
        P-->>C: 429 RATE_LIMITED (Retry-After: n) — US-07 AC-06
    else Verificación falla (aud ≠ client_id, iss ≠ accounts.google.com, iat/exp fuera de ventana, algoritmo ≠ RS256, firma inválida, nonce inválido)
        P-->>C: 401 (token de Google inválido)
    else email_verified no es true
        P-->>C: 401 EMAIL_NOT_VERIFIED — el server confía en el email SOLO si el claim es true (US-07 AC-04)
    else ID token válido y email verificado
        P->>A: LoginGoogle(sub, email, emailVerified=true)
        A->>R: findByGoogleSub(sub)

        alt google_sub ya existe (usuario Google conocido)
            A->>T: emitirPar(user.id)
            T-->>A: accessToken + refreshToken (sesión nuestra, sin refresh de Google)
            A-->>C: 200 { data: { accessToken, refreshToken, user } } — mismo contrato que /login
        else google_sub no existe
            A->>R: findByEmail(email)
            alt El email ya pertenece a un usuario solo-local (colisión)
                A-->>C: 409 EMAIL_ALREADY_EXISTS — details: [{ field: "provider", issue: "local" }] (sugiere «usar email y contraseña») — SIN auto-linking (US-08 AC-02)
            else Email libre
                Note over A,R: Alta implícita: google_sub, email, email_verified=1, password_hash NULL (CHECK: al menos una identidad)
                A->>R: save(user)
                A->>T: emitirPar(user.id)
                T-->>A: accessToken + refreshToken
                A-->>C: 200 { data: { accessToken, refreshToken, user } }
            end
        end
    end
```

Notas:

- Verificación estrictamente server-side con jose (`createRemoteJWKSet` con caché): `aud` = client_id configurado, `iss` = accounts.google.com, `iat`/`exp` dentro de ventana tolerada, algoritmo RS256 fijado, nonce validado si GIS lo incluye (doc 00 → ítems 43-44, US-07 AC-03).
- El ID token viaja en el body, NO como header `Authorization`; endpoint JSON sin cookies → sin CSRF clásico; CORS con allowlist (US-07 AC-06).
- Sesiones de usuarios Google usan **nuestros** refresh tokens (misma tabla, rotación y detección de reuso del diagrama 3); nunca se pide el refresh token de Google (doc 00 → ítem 47).
- `user.id` es el mismo `users.id` sin importar el proveedor: los endpoints protegidos no distinguen origen.

---

## 6. Magic link (solicitud + consumo) — US-09/US-10

```mermaid
sequenceDiagram
    participant C as Cliente
    participant P as Presentación
    participant A as Aplicación · RequestMagicLink / ConsumeMagicLink
    participant M as MagicLinkRepository
    participant R as UserRepository
    participant T as TokenService
    participant E as EmailSender
    participant DB as SQLite

    Note over C,A: Solicitud (US-09 / US-12)
    C->>P: POST /api/v1/auth/magic-link/request { email, intent: 'login' | 'password_reset' }
    P->>A: RequestMagicLink(emailNormalizado, intent, ttlMinutes, consumeBaseUrl)

    alt Payload inválido
        P-->>C: 422 VALIDATION_ERROR (email malformado)
    else Rate limit excedido
        P-->>C: 429 RATE_LIMITED (Retry-After: n)
    else Válido — siembre se genera/persiste/envía (anti-enumeración y auto-cuenta)
        A->>A: rawToken = randomBytes(32).base64url
        A->>A: tokenHash = sha256(rawToken) · expiresAt = now + ttl
        A->>M: insert({ tokenHash, email, purpose: intent, status: 'pending', expiresAt })
        M->>DB: INSERT INTO magic_links (...)
        alt intent = 'password_reset' (US-12)
            A->>E: sendPasswordResetEmail({ to, url: baseReset + '?token=' + rawToken })
        else intent = 'login' (US-09)
            A->>E: sendMagicLink({ to, url: baseConsumo + '?token=' + rawToken })
        end
        A-->>C: 200 { data: { ok: true } } — idéntico exista o no el email e independiente del intent
    end

    Note over C,A: Consumo (US-10)
    C->>P: POST /api/v1/auth/magic-link/consume { token }
    P->>A: ConsumeMagicLink(token)
    A->>A: tokenHash = sha256(token)
    A->>M: findByTokenHash(tokenHash)
    M->>DB: SELECT ... FROM magic_links WHERE token_hash = ?
    DB-->>M: fila | null

    alt Token inexistente / no pending / vencido / purpose='password_reset' → 401 idéntico (anti-enumeración + F3)
        A-->>C: 401 MAGIC_LINK_INVALID
    else Token válido y vigente (pending, purpose='login')
        A->>R: findByEmail(email)
        alt Email NO está registrado (AUTO-CUENTA, US-10 AC-02)
            Note over A,R: Alta implícita: provider 'magic', email_verified=1, sin password_hash ni google_sub (CHECK = email_verified permite la fila)
            A->>R: createUser({ id: uuid, email, passwordHash: null, googleSub: null, emailVerified: true })
        else Email ya registrado
            A->>R: markEmailVerified(email) — prueba posesión del email (US-10 AC-03)
        end
        A->>M: markUsed(tokenHash) — un solo uso
        A->>T: emitirPar(user.id) — provider 'magic'
        T-->>A: accessToken + refreshToken
        A-->>C: 200 { data: { accessToken, refreshToken, user } } — mismo contrato que /login
    end
```

Notas:

- **Anti-enumeración estricta (US-09 AC-02)**: la respuesta `200 { ok: true }` y el trabajo realizado (token + hash + insert + envío) son idénticos exista o no el email — sin side-channel temporal. El lado negativo (no enviar si no existe) fue **descartado**: es incompatible con la auto-cuenta (US-10 AC-02) porque un usuario nuevo jamás recibiría el link.
- **Hash, no claro (US-09 AC-03)**: la BD guarda solo `sha256(rawToken)`; un leak de `magic_links` no expone enlaces utilizables.
- **Un solo uso (US-10 AC-04)**: `markUsed` se ejecuta sobre el hash; reusar el token → 401 `MAGIC_LINK_INVALID` idéntico a inexistente/vencido (anti-enumeración).
- El email verificado del consume (auto-cuenta o `markEmailVerified`) habilita el CHECK de identidad `users` ampliado (`... OR email_verified = 1`, doc 04 → decisión 5).
- **Intento y propósito (US-12)**: `intent` del request (default `'login'`) se persiste como `purpose`; la URL de consumo la resuelve el handler según el intent (`MAGIC_LINK_CONSUME_BASE_URL` vs `MAGIC_LINK_PASSWORD_RESET_CONSUME_BASE_URL`, doc 00 → nº 56). **F3**: un enlace de `password_reset` presentado en el consume de sesión responde el mismo 401 idéntico.

---

### 6.1 Recuperación de contraseña — US-12

Mismo canal del diagrama 6 con `intent: 'password_reset'`: el enlace se envía contra
`MAGIC_LINK_PASSWORD_RESET_CONSUME_BASE_URL` y se persiste con `purpose = 'password_reset'`.

```mermaid
sequenceDiagram
    participant C as Cliente
    participant P as Presentación
    participant A as Aplicación · ResetPassword
    participant M as MagicLinkRepository
    participant R as UserRepository
    participant H as PasswordHasher
    participant DB as SQLite

    C->>P: POST /api/v1/auth/password/reset { token, password }
    P->>A: ResetPassword(token, newPassword)
    A->>A: tokenHash = sha256(token)
    A->>M: findByTokenHash(tokenHash)
    M->>DB: SELECT ... FROM magic_links WHERE token_hash = ?

    alt Token inexistente / no pending / vencido / purpose != 'password_reset' → 401 idéntico (F3)
        A-->>C: 401 MAGIC_LINK_INVALID
    else Token válido y vigente (pending, purpose='password_reset')
        A->>H: hash(newPassword) → argon2id
        A->>R: findByEmail(email)
        alt Email NO registrado (F2 — AUTO-CUENTA local)
            A->>R: createUser({ id: uuid, email, passwordHash, googleSub: null, emailVerified: true })
        else Email registrado
            A->>R: updatePasswordHash(user.id, passwordHash)
        end
        A->>M: markUsed(tokenHash) — un solo uso
        A->>R: revokeFamily(user.id) — F1: derriba TODAS las sesiones
        A-->>C: 204 No Content — NO emite sesión (el cliente redirige al login)
    end
```

Notas del reset:

- **Sin sesión**: el reset responde `204`, jamás un par de tokens — el flujo "olvidé" no crea sesión sin pasar por el login.
- **F1** — el reset derriba TODAS las sesiones (misma política que change-password, US-11): las sesiones emitidas bajo el secreto viejo dejan de valer; el cliente re-autentica con el nuevo.
- **F2** — email no registrado → auto-cuenta local (`email_verified = 1`): el enlace prueba la posesión del email (coherente con US-10 AC-02); quien "olvidó" su contraseña sin estar registrado queda registrado con la nueva.
- **F3** — separación de canales: un enlace de login no restablece contraseña, y un enlace de reset no crea sesión — ambos responden el mismo 401 `MAGIC_LINK_INVALID` (anti-enumeración).

---

## 7. Arquitectura por capas y sus puertos

```mermaid
flowchart LR
    C[Cliente / SPA] -->|HTTP · envelope JSON| P

    subgraph PRES[Presentación]
        P[routes / controllers]
    end

    subgraph APP[Aplicación]
        A[RegisterUser · Login · RefreshTokens · Logout · LoginGoogle · RequestMagicLink · ConsumeMagicLink · ChangePassword · ResetPassword]
    end

    subgraph DOM[Dominio]
        V[VOs: Email · PlainPassword · PasswordHash · UserId · Jti · GoogleSub · Provider · EmailVerified · MagicLinkStatus · MagicLinkPurpose]
        VA[«puerto» PasswordHasher]
        VB[«puerto» TokenService]
        VC[«puerto» UserRepository]
        VD[«puerto» Logger]
        VE[«puerto» MagicLinkRepository]
        VF[«puerto» EmailSender]
    end

    subgraph INF[Infraestructura]
        IA[Argon2PasswordHasher]
        IB[JoseTokenService]
        IC[DrizzleUserRepository]
        ID[PinoLogger]
        IE[DrizzleMagicLinkRepository]
        IF[ConsoleEmailSender]
    end

    DB[(SQLite)]
    JWKS[JWKS accounts.google.com]

    P --> A
    A --> V
    A --> VA
    A --> VB
    A --> VC
    A --> VD
    A --> VE
    A --> VF

    VA -.implementado por.-> IA
    VB -.implementado por.-> IB
    VC -.implementado por.-> IC
    VD -.implementado por.-> ID
    VE -.implementado por.-> IE
    VF -.implementado por.-> IF

    IC --> DB
    IE --> DB
    IB -->|jose · verify| JWKS
```

Notas:

- Dependencia estricta hacia adentro: `presentation → application → domain`; el dominio jamás importa Express, SQLite ni pino (doc 00 → ítem 25).
- Los puertos se definen en domain/application y los adapters se inyectan por constructor (DIP): cambiar argon2 por scrypt o SQLite por Postgres implica **añadir un adaptador**, nunca tocar el dominio (doc 00 → ítem 26, OCP).
- Los VOs brandeados con Zod (sección 6.1) son el vocabulario del dominio: el input sucio se parsea una sola vez en la frontera y circula como tipo ya válido (*parse, don't validate*).
- El `EmailSender` es un puerto con una impl de consola (`ConsoleEmailSender`, loguea `to` + `url` en desarrollo); en producción se sustituye por un adapter SMTP/transaccional sin tocar el caso de uso.

---

## Trazabilidad

| Diagrama | Historia | Consideraciones (doc 00) |
|---|---|---|
| 1. Registro local | US-01, US-08 (AC-01) | 16-24, 35, 38, 41, 49 |
| 2. Login local | US-02 | 35, 40, 41 |
| 3. Refresco de tokens | US-03 | 38, 40 |
| 4. Logout | US-04 | 38, 42 |
| 5. Login con Google | US-07, US-08 (AC-02) | 43-47 |
| 6. Magic link (+ reset 6.1) | US-09, US-10, US-12 | 38, 41, 55, 56 |
| 7. Capas y puertos | (transversal) | 25-28, 6.1 |