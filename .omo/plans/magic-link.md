# Plan · Sign up / Sign in mediante Magic Link

**Fecha**: 2026-09-03
**Autor**: Sisyphus (QA/refactor de signup-login-jwt-uuid-rol-api)
**Estado**: Plan aprobado por el usuario (5 decisiones resueltas)

---

## 0. Decisiones aprobadas (input del usuario)

1. **Auto-cuenta**: el primer magic link de un email crea la cuenta automáticamente e inicia sesión. Sin contraseña nunca. Un solo flujo (como Slack/Notion).
2. **Token opaco + hash en DB**: token opaco de alta entropía (32 bytes) en la URL; solo el hash SHA-256 se persiste en la tabla (coherente con `refresh_tokens`, doc 00 → ítem 38). Un solo uso por `status`.
3. **Nuevo provider `'magic'`**: se extiende `Provider` de `['local','google']` a `['local','google','magic']`. Impacta `providerSchema`, la `CHECK providers` de `refresh_tokens` y `users_identity_check`.
4. **Puerto `EmailSender` + impl console**: puerto de dominio (`domain/port/emailSender.ts`); implementación en infra que en esta etapa loguea el link a consola (dev/test), lista para conectar SMTP/Resend después.
5. **`emailVerified=true`** al consumir un magic link (prueba criptográfica de posesión del email).

---

## 1. Objetivo

Agregar a la API la capacidad de iniciar sesión (y auto-registrarse) sin contraseña mediante un correo con un _magic link_. El flujo es de **dos endpoints**:

- **`POST /auth/magic-link/request`** — `{ email }` → crea un token opaco, lo guarda (hash) en DB y lo envía por email. **Siempre devuelve `200 { ok: true }`** (anti-enumeración), incluso si el email no existe.
- **`POST /auth/magic-link/consume`** — `{ token }` → valida el token opaco (hash + expiración + un solo uso), auto-crea el usuario si no existe, marca `emailVerified=true`, revoca el token (un solo uso) y emite sesión completa (access + refresh, provider `'magic'`).

> Mismo contrato de envelope/semántica HTTP del resto de la API (doc 01 sección "Convenciones transversales").

---

## 2. Contrato OpenAPI (docs/03-openapi.yaml)

Nuevos paths y schemas, siguiendo el estilo existente.

### Paths

```yaml
/auth/magic-link/request:
  post:
    summary: Solicita un magic link de acceso (con auto-registro)
    tags: [auth]
    requestBody: { content: { application/json: { schema: { $ref: '#/components/schemas/MagicLinkRequest' } } } }
    responses:
      '200':
        description: Siempre 200 (anti-enumeración)
        content: { application/json: { schema: { $ref: '#/components/schemas/MagicLinkRequestResponse' } } }
      '422': { $ref: '#/components/responses/ValidationError' }
      '429': { $ref: '#/components/responses/RateLimited' }

/auth/magic-link/consume:
  post:
    summary: Consume un magic link y emite una sesión
    tags: [auth]
    requestBody: { content: { application/json: { schema: { $ref: '#/components/schemas/MagicLinkConsumeRequest' } } } }
    responses:
      '200':
        description: Sesión emitida
        content: { application/json: { schema: { $ref: '#/components/schemas/MagicLinkConsumeResponse' } } }
      '401': { $ref: '#/components/responses/Unauthorized' }
      '422': { $ref: '#/components/responses/ValidationError' }
      '429': { $ref: '#/components/responses/RateLimited' }
```

### Schemas

```yaml
MagicLinkRequest:
  type: object
  required: [email]
  properties:
    email: { $ref: '#/components/schemas/Email' }

MagicLinkRequestResponse:
  type: object
  required: [data]
  properties:
    data:
      type: object
      required: [ok]
      properties: { ok: { type: boolean, const: true } }

MagicLinkConsumeRequest:
  type: object
  required: [token]
  properties:
    token: { type: string, minLength: 1 }

MagicLinkConsumeResponse:
  type: object
  required: [data]
  properties:
    data:
      type: object
      required: [accessToken, refreshToken, user]
      properties:
        accessToken: { type: string }
        refreshToken: { type: string }
        user: { $ref: '#/components/schemas/UserSummary' }
```

> Se reusa `UserSummary`/`Email` ya definidos en el contrato para register/login.

---

## 3. Modelo de datos (docs/04-modelo-de-datos.md + src/db/schema.ts)

### Nueva tabla `magic_links` (1:1 con nueva sección en doc 04 + DDL)

| columna | tipo | constraints |
|---|---|---|
| `id` | TEXT PK | UUID v4 (`crypto.randomUUID()`) |
| `token_hash` | TEXT NOT NULL | `uniqueIndex` (hash SHA-256 del opaco) |
| `email` | TEXT NOT NULL | email a autenticar |
| `status` | TEXT NOT NULL DEFAULT 'pending' | `CHECK (status IN ('pending','used','revoked'))` |
| `expires_at` | TEXT NOT NULL | ISO 8601 |
| `created_at` | TEXT NOT NULL | ISO 8601 |

No hay FK a `users` (el usuario puede no existir todavía en el request; se crea lazy en consume). La clave para únicos es `token_hash`.

### Cambios en `refresh_tokens` (migración)

- Extiende la `CHECK provider` de `IN ('local','google')` a `IN ('local','google','magic')`.
- No hay `users_identity_check` que tocar en `refresh_tokens` (esa CHECK es de `users`).
- **`users_identity_check`** (`password_hash IS NOT NULL OR google_sub IS NOT NULL`): **requiere cambio** porque un usuario creado por magic link no tendrá `password_hash` ni `google_sub`. Nueva condición: `password_hash IS NOT NULL OR google_sub IS NOT NULL OR email_verified = 1`. (El magic link marca `emailVerified` en consume, pero el usuario se crea con `emailVerified=false` transitoriamente en el request con email existente... ver Nota de riesgo #5.)

### Migración drizzle

`npx drizzle-kit generate` para generar el nuevo SQL de la tabla y las CHECKs. Verificar que la migración se aplique con `migrate()` en `compose.ts` (ya lo hace).

---

## 4. Dominio

### 4.1 Nuevo VO — `MagicLinkToken` (o tipo opaco reutilizando patrón)

No se necesita un VO nuevo si se maneja como `string` con zod en la frontera. Se define el tipo opaco en el puerto (ver 4.2). Reutilizar `crypto.randomBytes(32).toString('hex')` para el opaco.

### 4.2 Nuevo puerto — `domain/port/magicLinkRepository.ts`

Sigue el patrón de `UserRepository`.

```ts
export type MagicLinkRecord = {
  id: string;
  tokenHash: string;
  email: Email;
  status: MagicLinkStatus; // 'pending' | 'used' | 'revoked'
  expiresAt: Timestamp;
};

export interface MagicLinkRepository {
  insert(token: {
    id: UserId;          // o string id propio
    tokenHash: string;
    email: Email;
    expiresAt: Timestamp;
  }): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<MagicLinkRecord | null>;
  markUsed(tokenHash: string): Promise<void>;
  revokeAllForEmail(email: Email): Promise<void>; // opcional: revocar anteriores al emitir uno nuevo
}
```

> `Email`, `UserId`, `Timestamp` ya existen en `domain/vo`.

### 4.3 Nuevo puerto — `domain/port/emailSender.ts`

```ts
/** Puerta de salida para envío de email (doc 00 → ítems). En esta etapa la impl loguea a consola. */
export interface EmailSender {
  sendMagicLink(input: { to: Email; url: string }): Promise<void>;
}
```

### 4.4 VO `Provider` — extender enum

`domain/vo/provider.ts`: `z.enum(['local', 'google', 'magic'])`. Actualizar `providerSchema`.

### 4.5 Catálogo de errores — `domain/errorCatalog.ts`

Nuevo código (Record exhaustivo; agregar sin mensaje = falla compilación):

```ts
// ErrorCodes
MAGIC_LINK_INVALID: 'MAGIC_LINK_INVALID', // token inexistente, vencido, malformado o usado

// ERROR_MESSAGES
MAGIC_LINK_INVALID: 'Enlace de acceso inválido o expirado.',
```

> Consumo fallido (inexistente/vencido/usado) → **401 genérico idéntico** (anti-enumeración, patrón del refresh). Usar `UNAUTHORIZED` o un `MAGIC_LINK_INVALID` que mapee a 401 en `STATUS_BY_CODE`. Recomendación: código propio `MAGIC_LINK_INVALID` → 401 para trazabilidad del cliente sin revelar causa.

### 4.6 LOG_EVENTS — `domain/port/logEvents.ts`

Nuevos eventos: `MAGIC_LINK_REQUESTED`, `MAGIC_LINK_CONSUMED`, `MAGIC_LINK_INVALID_ATTEMPT`, `USER_REGISTERED_VIA_MAGIC_LINK`. (Ver archivo real para respetar el formato.)

---

## 5. Capa de aplicación (`src/app/`)

### 5.1 Nuevo use case — `src/app/requestMagicLink.ts`

```ts
export type RequestMagicLinkCommand = { email: string; now?: Date; baseUrl: string };

export class RequestMagicLink {
  constructor(
    private readonly users: UserRepository,
    private readonly magicLinks: MagicLinkRepository,
    private readonly sender: EmailSender,
    private readonly tokens: TokenIssuer, // para hash (reutilizar hashRefreshToken? ver nota)
    private readonly logger: Logger,
  ) {}

  async execute(cmd): Promise<{ ok: true }> {
    // 1. validar email (emailSchema)
    // 2. NUNCA revelar si existe: generar token opaco + hash SIEMPRE (aunque el email no exista).
    // 3. Si el email existe → insertar fila magic_links + enviar email con URL {baseUrl}/auth/magic-link/consume?token=...
    //    Si NO existe → NO insertar ni enviar (o enviar un email genérico). Se decide anti-enumeración completa:
    //    opción A: no hacer nada si no existe (0 trabajo, 0 observación side-channel).
    //    opción B: insertar+enviar igual con token igualmente inutilizable al consumir (consume fallará 401 porque no hay user).
    //    Recomendado: A (no hacer nada). Documentar que consume devuelve 401 si no hay usuario.
    // 4. log info MAGIC_LINK_REQUESTED (sin token)
    // 5. return { ok: true }
  }
}
```

> **Nota anti-enumeración**: el request siempre responde `200 { ok: true }`. La decisión A implica que, si el email no existe, no se genera trabajo ni email — es el enfoque estándar (Slack). El consume de un token nunca enviado da 401.

### 5.2 Nuevo use case — `src/app/consumeMagicLink.ts`

```ts
export class ConsumeMagicLink {
  constructor(users, magicLinks, tokens, logger) {}

  async execute(cmd: { token: string; refreshTtlDays: number; now?: Date }): Promise<ConsumeMagicLinkResult> {
    // 1. tokenHash = hash(opaco)
    // 2. find = magicLinks.findByTokenHash(tokenHash)
    //    if (!find) throw MAGIC_LINK_INVALID
    //    if (find.status !== 'pending') throw MAGIC_LINK_INVALID  // un solo uso (reuso)
    //    if (expired) throw MAGIC_LINK_INVALID
    // 3. user = users.findByEmail(find.email)
    //    if (!user) { // auto-cuenta
    //       id = randomUUID()
    //       users.createUser({ id, email, passwordHash: null, googleSub: null, emailVerified: true, createdAt })
    //    } else { // ya existe → marcar emailVerified=true
    //       users.markEmailVerified(find.email)  // NUEVO método en repo
    //    }
    // 4. magicLinks.markUsed(tokenHash)  // un solo uso
    // 5. session = issueSession(tokens, users, { userId, provider: 'magic', refreshTtlDays, now })
    // 6. log
    // 7. return { accessToken, refreshToken, user: { id, email, createdAt } }
  }
}
```

### 5.3 `UserRepository` — nuevo método

`src/domain/port/userRepository.ts` (y su impl en `drizzleUserRepository.ts`):

```ts
/** Marca email_verified = true (magic link consume). */
markEmailVerified(email: Email): Promise<void>;
```

### 5.4 Composición en `src/app/useCases.ts`

- Ampliar `UseCasePorts` con `magicLinks: MagicLinkRepository` y `sender: EmailSender`.
- Ampliar `UseCases` con `requestMagicLink` y `consumeMagicLink`.

---

## 6. Infraestructura (`src/infra/`)

### 6.1 `src/infra/drizzleMagicLinkRepository.ts` (nuevo)

Implementa `MagicLinkRepository` sobre la tabla `magic_links` (patrón de `drizzleUserRepository`). `insert` con try/catch → `UniqueConstraintViolation` (DIP).

### 6.2 `src/infra/consoleEmailSender.ts` (nuevo)

```ts
export class ConsoleEmailSender implements EmailSender {
  constructor(private readonly logger: Logger) {}
  async sendMagicLink({ to, url }): Promise<void> {
    this.logger.info(/* MAGIC_LINK_EMAIL_DEBUG */, { to, url });
  }
}
```

> En esta etapa "envía" a consola (dev/test). Documentado como placeholder listo para conectar SMTP/Resend.

### 6.3 `src/infra/compose.ts`

- `ComposeOverrides`: añadir `magicLinks?: MagicLinkRepository` y `sender?: EmailSender` (inyectables en tests).
- `InfraPorts`: añadir `magicLinks`, `sender`.
- En `composeInfra`: instanciar `DrizzleMagicLinkRepository` y `ConsoleEmailSender`.

---

## 7. Presentación (`src/api/routes.ts`)

- Nuevas rutas con `authLimiter`:
  ```ts
  router.post('/auth/magic-link/request', authLimiter, async (req,res,next) => {
    const body = magicLinkRequest.parse(req.body);
    await useCases.requestMagicLink.execute({ email: body.email, baseUrl: config.magicLink.baseUrl });
    res.status(200).json({ data: { ok: true } });
  });

  router.post('/auth/magic-link/consume', authLimiter, async (req,res,next) => {
    const body = magicLinkConsumeRequest.parse(req.body);
    const result = await useCases.consumeMagicLink.execute({ token: body.token, refreshTtlDays: config.refreshTtlDays });
    res.status(200).json({ data: result });
  });
  ```
- Ampliar `UseCases` local de `routes.ts` con los dos casos nuevos.
- `ALLOWED_METHODS`: añadir ambos paths con `['POST']`.
- Schemas zod nuevos (`magicLinkRequest`, `magicLinkConsumeRequest`).

### Config (`src/config.ts`)

- Nuevo campo `magicLink`: `{ ttlMinutes, baseUrl }` con defaults y validación zod (patrón del resto).
- `baseUrl` será la URL pública del front/cliente que arma el link de consumo.

---

## 8. Bootstrap (`src/index.ts`)

Sin cambios de estructura (composeInfra + buildUseCases ya lo manejan). Solo pasan los nuevos puertos automáticamente.

---

## 9. Tests

### TDD — nuevas suites en `test/`

1. **`test/requestMagicLink.test.ts`**: fiscaliza que el request siempre responde ok; no revela existencia; inserta+envía cuando el email existe; NO inserta/envía cuando no existe (decisión A); token opaco ≠ hash persistido.
2. **`test/consumeMagicLink.test.ts`**: token válido → sesión + un solo uso (2º consume = 401) + auto-cuenta (usuario nuevo) + `emailVerified` marcado en existente + expiración → 401.
3. **`test/consoleEmailSender.test.ts`**: `sendMagicLink` loguea to+url, sin token en logs.

### Fakes

- `FakeMagicLinkRepository` (en memoria) y `FakeEmailSender` (captura envíos) — patrón de `FakeGoogleVerifier` en e2e.

### E2E (`test/e2e.test.ts`)

- Nuevo test: request → (el fake captura el url) → consume → 200 con access+refresh → session emitida.
- Actualizar el registro del conteo total (34 → nuevo).

### Verificación

```
npm run typecheck && npm run lint && npx vitest run && npm run build
```

---

## 10. Documentación

- **`docs/01-historias-de-usuario.md`**: nuevas US (US-09 magic link request, US-10 magic link consume) con AC (anti-enumeración, un solo uso, expiración, auto-cuenta, emailVerified).
- **`docs/02-flujos-registro-autenticacion.md`**: nuevo §7 con diagrama mermaid (request + consume con auto-cuenta).
- **`docs/03-openapi.yaml`**: §2 (schemas/paths) + regenerar `src/contract.ts` si existe.
- **`docs/04-modelo-de-datos.md`**: tabla `magic_links` + decisión derivada nueva (emailVerified vía magic link) + provider 'magic'.
- **`docs/05-qa-verificacion-arquitectura.md`**: §15 registro de esta iteración.
- **`docs/00-consideraciones-tecnicas.md`**: ítem nuevo para EmailSender y magic link (tokens opacos, anti-reuso).

---

## 11. Fases de implementación (orden)

| Fase | Contenido |
|---|---|
| **A** | Modelo de datos: `magic_links` en `schema.ts` + `drizzle-kit generate` + doc 04. Impl `DrizzleMagicLinkRepository`. |
| **B** | Dominio: VO provider 'magic', ErrorCodes `MAGIC_LINK_INVALID` + mensaje, LOG_EVENTS, puertos `MagicLinkRepository`, `EmailSender`, `markEmailVerified` en UserRepository. |
| **C** | App: `RequestMagicLink`, `ConsumeMagicLink`, `useCases.ts` (ports + cases). Reutilizar `issueSession`. |
| **D** | Infra: `DrizzleMagicLinkRepository`, `ConsoleEmailSender`, `compose.ts`. |
| **E** | Presentación: rutas + schemas zod + `ALLOWED_METHODS` + config `magicLink`. |
| **F** | Composición/bootstrap: pasos en `index.ts` (automáticos vía compose/buildUseCases). |
| **G** | Tests: fakes + suites unitarias + e2e. Correr verificación completa. |
| **H** | Docs: openapi+contract, historias, flujos, modelo, QA, consideraciones. |

---

## 12. Riesgos y pitfalls (a vigilar en implementación)

1. **Anti-enumeración en request**: debe devolver `200 { ok: true }` SIEMPRE (incluso email inexistente). Nunca `404`/`409`.
2. **Un solo uso**: el token debe revocarse/`markUsed` tras consumirse; reuso → 401 idéntico (patrón refresh reuse → revoca familia).
3. **Expiración**: `now > expires_at` → 401. TTL corto (5-15 min recomendado) configurable en `config.magicLink.ttlMinutes`.
4. **No loguear el token opaco ni el hash**: solo el hash se persiste; logs nunca contienen token ni URL completa con token.
5. **`users_identity_check`** (password_hash OR google_sub): un usuario auto-creado por magic link no tiene ninguno → **la CHECK debe ampliarse** para no romper `createUser`. Decidir si se permite `email_verified=1` como tercera vía de identidad. **Esto es un cambio en el schema que requiere re-migración y validación.**
6. **Migración de `refresh_tokens.provider` CHECK**: extender a 'magic' sin romper filas existentes.
7. **Race condition en auto-cuenta**: dos consumes simultáneos del mismo token → el 2º debe fallar por "ya usado" (un solo uso protege). El `createUser` con email duplicado debe lanzar `UniqueConstraintViolation` → tratar como 401 (token ya usado / cuenta concurrente).
8. **Hash reuse**: `hashRefreshToken` de `TokenIssuer` ya usa SHA-256; verificar que sea reutilizable para magic links o crear método propio en el repo (sin acoplar dominio a JWT). Recomendación: exponer el hash en `MagicLinkRepository` como función local `sha256` en infra o reutilizar `TokenIssuer.hashRefreshToken` por simplicidad (documentar acoplamiento).
9. **Rate limit**: ambos endpoints bajo `authLimiter` (ya estricto en `/auth`).
10. **`baseUrl` de config**: el link de consumo debe apuntar al endpoint correcto (`/api/v1/auth/magic-link/consume?token=...`); en producción sería un front que redirige.

---

## 13. Criterios de aceptación del plan (done)

- [ ] Ambos endpoints funcionan y cumplen anti-enumeración / un solo uso / expiración.
- [ ] Provider 'magic' persistido y CHECK migrada.
- [ ] `emailVerified` se marca al consumir.
- [ ] `EmailSender` definido y con impl console funcional.
- [ ] `users_identity_check` no rompe el auto-registro.
- [ ] typecheck + lint + vitest (todos, antiguos + nuevos) + build OK.
- [ ] OpenAPI + contract + docs actualizados.
