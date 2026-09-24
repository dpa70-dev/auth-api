# Glosario de Autenticación

> Términos y conceptos usados en el proceso de autenticación del proyecto
> `signup-login-jwt-uuid-rol-api`.

---

## Tokens y Sesiones

| Término | Definición en este proyecto |
|---|---|
| **JWT (JSON Web Token)** | Estandar RFC 7519 para transmitir información firmada entre partes. Compuesto por tres partes separadas por puntos: `header.payload.signature`. El header declara el algoritmo de firma (`{ "alg": "HS256" }`). El payload contiene los claims (afirmaciones). La firma garantiza integridad e integridad (el receptor puede verificar que el contenido no fue alterado). En este proyecto se usa **HS256** (HMAC-SHA256) con un secret compartido. |
| **Access Token** | JWT firmado con **HS256** que contiene los claims `sub`, `iat` y `exp`. Vida corta (5-15 min configurable). Es lo que el cliente envía en cada request para acceder a recursos protegidos. Generado en `joseTokenService.ts → issueAccessToken()`. |
| **Refresh Token** | Token **opaco** (no-JWT): 32 bytes aleatorios en `base64url`. Solo se almacena su **hash SHA-256** en base de datos, nunca el token en claro. Vida larga (configurable en días). Se usa para obtener nuevos access tokens sin re-autenticar. Generado en `joseTokenService.ts → issueRefreshToken()`. |
| **Token Opaco** | Refresh token que no tiene estructura interna JWT — es una cadena aleatoria ilegible. Su secreto reside en que solo el hash SHA-256 se persiste (`hashRefreshToken()`), nunca el valor crudo. |
| **Rotación de Refresh** | Cada vez que se consume un refresh token para obtener un nuevo par de tokens, el refresh anterior se marca como `"used"` y se emite uno nuevo. Esto invalida el token previo. Implementado en `refreshTokens.ts → execute()`. |
| **Reuso de Refresh (Reuse Detection)** | Si un refresh token que ya está en estado `"used"` o `"revoked"` se presenta de nuevo, significa robo/filtración. El sistema revoca **toda la familia** del usuario (todos sus refresh tokens) y responde 401. Implementado en `refreshTokens.ts → execute()` (US-03 AC-03). |
| **Familia de Refresh** | Grupo de refresh tokens vinculados a un usuario. En esta iteración, `familyId = userId`. Revocar la familia = revocar todos los refresh tokens del usuario. Tabla `refresh_tokens.familyId`. |
| **Sesión (Session)** | Par `accessToken + refreshToken` emitido por `issueSession()`. Representa una sesión autenticada del usuario. Se crea en registro, login, refresh, login con Google y consumo de magic link. |
| **JTI (JWT ID)** | Identificador único (`UUID v4`) de cada refresh token. Se persiste en la tabla `refresh_tokens.jti` para rastreo individual. Validado con Zod (`jtiSchema`). |

---

## Claims del JWT

| Claim | Nombre | Definición |
|---|---|---|
| **`sub`** | Subject | Claim que identifica **a quién pertenece el token**. En este proyecto contiene el `UserId` (UUID v4 del usuario) que se emitió el access token. Es el claim principal del payload JWT. Definido en `AccessTokenPayload.sub` dentro de `domain/port/tokenIssuer.ts`. |
| **`iat`** | Issued At | Claim numérico que indica **el momento en que se emitió el token**, en formato Unix timestamp (segundos desde epoch 1970-01-01T00:00:00Z). Se calcula con `Math.floor(Date.now() / 1000)` en `joseTokenService.ts → interval()`. |
| **`exp`** | Expiration Time | Claim numérico que indica **el momento en que el token expira**, en formato Unix timestamp. Se calcula como `iat + accessTtlMinutes * 60` en `joseTokenService.ts → interval()`. La librería `jose` lo valida automáticamente al verificar el token (`jwtVerify` rechaza tokens con `exp` vencido). |

---

## Estados del Refresh Token

| Estado | Significado |
|---|---|
| `"active"` | Token válido y disponible para usar. |
| `"used"` | Ya fue canjeado para obtener nuevos tokens (rotación exitosa). |
| `"revoked"` | Invalidado manualmente (logout) o por reuso detectado (seguridad). |

Definido en `vo/refreshTokenStatus.ts` como `z.enum(['active', 'used', 'revoked'])`.

---

## Estados de Moderación del Usuario

| Estado | Significado |
|---|---|
| `"active"` | Cuenta operativa: todos los flujos de emisión de sesión funcionan con normalidad. |
| `"suspended"` | Cuenta bloqueada (temporal). Los flujos de emisión responden **403 FORBIDDEN** genérico (anti-enumeración) y **todas** sus sesiones se revocan al suspender. |
| `"banned"` | Cuenta bloqueada (definitivo). Mismo comportamiento que `"suspended"`; la distinción es política (ban sin borrar la fila). |

Lo muta solo `PATCH /admin/users/{id}/status` (require auth + `requireRole('admin')`),
que retorna `200 { data: { id, status } }`. Volver a `active` NO re-emite sesiones. Definido
en `vo/userStatus.ts` como `z.enum(['active', 'suspended', 'banned'])`. Eje independiente de
`kind` (identidad) y `role` (permisos) — sin kitchen-sink (doc 04 → §3).

---

## Contraseña y Hash

| Término | Definición |
|---|---|
| **PlainPassword** | Contraseña en claro que el usuario ingresa. Validada: 8-64 caracteres (NIST 800-63B: sin reglas de complejidad artificial). **Nunca se persiste**. Validada con Zod en `vo/plainPassword.ts`. |
| **PasswordHash** | Hash de la contraseña generado con **Argon2**. Es lo que se almacena en `users.passwordHash`. Se calcula en `argon2PasswordHasher.ts → hash()` y se verifica con `verify()`. |
| **Argon2** | Algoritmo de hashing de contraseña seleccionado. Opciones configuradas en `ARGON2_OPTIONS`. Se elige por resistencia a ataques GPU/ASIC. Implementado en `infra/argon2PasswordHasher.ts`. |
| **fakeHash** | Hash simulado que se devuelve cuando el usuario no existe. Previene **timing attacks**: si un email no registrado siempre retorna un hash del mismo tiempo de cálculo que uno válido, el atacante no puede medir diferencias temporales para enumerar emails. |

---

## Identificadores y Tipos de Valor (Value Objects)

| VO | Definición | Formato |
|---|---|---|
| **UserId** | Identificador único del usuario en `users.id`. | UUID v4, validado con Zod. Nunca autoincremental. |
| **Email** | Email del usuario en `users.email`. | Normalizado a minúsculas, trim, max 254 chars. Índice único. |
| **PasswordHash** | Hash Argon2 de la contraseña. | String (nullable: `null` si es solo-Google). |
| **GoogleSub** | Identificador `sub` del token ID de Google. | String (nullable: `null` si es solo-local). |
| **UserRole** | Rol de autorización del usuario. | Enum: `"user"`, `"admin"` (schema en `vo/userRole.ts`). |
| **UserStatus** | Estado de moderación del usuario. | Enum: `"active"`, `"suspended"`, `"banned"` (schema en `vo/userStatus.ts`). |
| **Timestamp** | Marca de tiempo ISO 8601. | `string` en formato ISO (ej: `2026-09-04T...`). |
| **Provider** | Indicador del proveedor de autenticación. | Enum: `"local"`, `"google"`, `"magic"` (schema en `vo/provider.ts`). |

---

## Entidad User

| Campo | Tipo | Regla |
|---|---|---|
| `id` | `UserId` (UUID) | Generado al registrar |
| `email` | `Email` | Normalizado, único |
| `passwordHash` | `PasswordHash \| null` | `null` si es solo-Google |
| `googleSub` | `GoogleSub \| null` | `null` si es solo-local |
| `emailVerified` | `boolean` | `false` para registro local, `true` para Google o magic link |
| `kind` | `UserKind` | `"registered"` (con identidad) o `"guest"` (anónima, US-15) |
| `role` | `UserRole` | `"user"` (default) o `"admin"` (US-17: `PATCH /admin/users/{id}/role`) |
| `status` | `UserStatus` | `"active"` (default), `"suspended"` o `"banned"` (US-18/19/20: `PATCH /admin/users/{id}/status`) |
| `createdAt` | `Timestamp` | ISO 8601 |

**Invariantes:** No se permite usuario con `passwordHash = null` **y** `googleSub = null` (CHECK en BD + refinamiento Zod en `entity/user.ts`).

---

## Proveedores de Autenticación

| Proveedor | Descripción |
|---|---|
| **local** | Registro y login tradicional con email + contraseña. Requiere verificación de email posterior. |
| **google** | Login con Google OAuth. El `sub` del JWT de Google se usa como identificador. `emailVerified = true` porque Google ya verificó el email (US-07 AC-02). Implementado en `loginGoogle.ts` + `infra/googleJwtVerifier.ts`. |
| **magic** | Magic link (enlace mágico). Se envía un enlace por email; clic en el enlace prueba posesión del email. Implementado en `requestMagicLink.ts` + `consumeMagicLink.ts`. |

---

## Magic Link

| Término | Definición |
|---|---|
| **Magic Link** | Enlace enviado por email que contiene un token opaco. Hacer clic prueba posesión del email (alternativa a verificar con código OTP). |
| **Request Magic Link** | `POST /auth/magic-link/request` — Genera un token opaco, persiste su hash, envía URL por email. Respuesta siempre `200 { ok: true }` (anti-enumeración: misma respuesta si el email existe o no). Implementado en `requestMagicLink.ts`. |
| **Consume Magic Link** | `POST /auth/magic-link/consume` — Valida el token, marca `"used"`, crea sesión. Si el email no tiene cuenta → crea auto-cuenta (US-10) con `emailVerified = true`. Implementado en `consumeMagicLink.ts`. |
| **Auto-cuenta (US-10)** | Si un magic link se consume con un email no registrado, el sistema crea la cuenta automáticamente al validar el enlace. La posesión del email es la verificación. |
| **Anti-enumeración** | Propiedad de seguridad: el sistema responde de forma idéntica y realiza la misma cantidad de trabajo (generar token, hash, persistir, intentar enviar) independientemente de si el email está registrado. Un atacante no puede distinguir por tiempo de respuesta ni por el body de la respuesta. |
| **MagicLinkStatus** | Estados: `"pending"` (recién creado), `"used"` (ya consumido), `"revoked"` (invalidado). Definido en `vo/magicLinkStatus.ts`. |
| **consumeBaseUrl** | URL de consumo compuesta en `config.ts`: `${origin}${API_PREFIX}/auth/magic-link/consume` (origin = `PUBLIC_API_ORIGIN` o `HOST:PORT` en dev). El token se agrega: `${consumeBaseUrl}?token=${rawToken}`. |

---

## Endpoints de Autenticación

| Ruta | Caso de Uso | Descripción |
|---|---|---|
| `POST /auth/register` | RegisterUser | Crea usuario local con email + password. Respuesta: userId + sesión (tokens). |
| `POST /auth/login` | Login | Valida credenciales email + password. Respuesta: userId + sesión. |
| `POST /auth/refresh` | RefreshTokens | Intercambia refresh token válido por nuevo par access + refresh. |
| `POST /auth/logout` | Logout | Revoca el refresh token enviado (soft-revoke). |
| `POST /auth/google` | LoginGoogle | Login/registro con Google ID token. Si el `googleSub` no existe, crea cuenta implícita con `emailVerified = true`. |
| `POST /auth/magic-link/request` | RequestMagicLink | Solicita envío de magic link por email. |
| `POST /auth/magic-link/consume` | ConsumeMagicLink | Valida magic link, crea auto-cuenta si es necesario, devuelve sesión. |

---

## Arquitectura y Patrones

| Término | Definición en este proyecto |
|---|---|
| **Hexagonal Architecture (Puertos y Adaptadores)** | El dominio define interfaces (`UserRepository`, `TokenIssuer`, `PasswordHasher`, etc.) como **puertos**. La infraestructura provee **adaptadores** que implementan esos puertos (`DrizzleUserRepository`, `JoseTokenService`, `Argon2PasswordHasher`). El dominio nunca conoce Express, SQLite ni ninguna tecnología externa. |
| **Value Objects (VO)** | Tipos tipados con validación Zod que encapsulan reglas de negocio (`UserId`, `Email`, `PlainPassword`, `Jti`, `Timestamp`, `RefreshTokenStatus`, etc.). Garantizan que solo entren datos válidos al dominio. |
| **Entity** | Objeto con identidad mutable (en este caso inmutable por diseño): la entidad `User` se construye solo desde VOs validados o desde resultados de repositorio pre-validados. |
| **Use Case (Caso de Uso)** | Clase con un único método `execute()` que orquesta la lógica de negocio. Ejemplos: `RegisterUser`, `Login`, `RefreshTokens`, `Logout`, `LoginGoogle`, `RequestMagicLink`, `ConsumeMagicLink`. Compuestos en `useCases.ts` → `buildUseCases()`. |
| **Ports (Puertos)** | Interfaces TypeScript que el dominio define y la infraestructura implementa: `UserRepository`, `TokenIssuer`, `PasswordHasher`, `Logger`, `EmailSender`, `MagicLinkRepository`, `GoogleIdTokenVerifier`. Separación pura dominio/infra (Dependency Inversion Principle). |
| **Command** | Objeto que encapsula los datos de entrada de un caso de uso (ej: `RefreshTokensCommand`, `RequestMagicLinkCommand`). Tipado con TypeScript. |
| **TokenIssuer** | Puerto/interface que define: `issueAccessToken()`, `verifyAccessToken()`, `issueRefreshToken()`, `hashRefreshToken()`. Implementado por `JoseTokenService`. |
| **PasswordHasher** | Puerto/interface que define: `hash()` y `verify()`. Implementado por `Argon2PasswordHasher`. |
| **Drizzle ORM** | ORM utilizado para interactuar con SQLite (Better-SQLite3). Definición de tablas en `db/schema.ts`. Repositorio en `infra/drizzleUserRepository.ts`. |
| **Composition Root** | `compose.ts` + `index.ts`: instancian todas las implementaciones, conectan puertos con adaptadores, y montan la aplicación HTTP. |

---

## Seguridad

| Concepto | Implementación |
|---|---|
| **HS256** | Algoritmo de firma JWT: HMAC-SHA256 con un secret compartido (symmetric). Usado para access tokens. |
| **SHA-256 (refresh)** | Hash del refresh token opaco. Lo único que se almacena en BD. Si la BD se compromete, los refresh tokens no están expuestos en claro. |
| **Timing Attack Prevention** | `fakeHash` en `Argon2PasswordHasher`: cuando el usuario no existe, se retorna un hash del mismo tiempo de cómputo para que el atacante no pueda medir diferencias temporales y enumerar emails registrados. |
| **Anti-enumeración** | Requests con email no registrado producen la misma respuesta HTTP, el mismo trabajo computacional y el mismo tiempo de respuesta que requests con email registrado. |
| **Soft Revoke** | Logout marca el refresh token como `"revoked"` en BD en vez de eliminarlo. Permite detectar intentos de reuso posterior. |
| **Hard Revoke (Familia)** | Reuso detectado → `revokeFamily()` revoca **todos** los refresh tokens del usuario (`SET status = 'revoked' WHERE familyId = userId`). |
| **emailVerified** | Boolean que indica si el email fue verificado. `false` para registro local (pendiente magic link), `true` para Google y magic link consumido. |
| **UniqueConstraintViolation** | Error de dominio que se lanza cuando se intenta crear un usuario con email o googleSub duplicado. Se detecta por regex en el error SQL de SQLite (`UNIQUE|SQLITE_CONSTRAINT`). |
