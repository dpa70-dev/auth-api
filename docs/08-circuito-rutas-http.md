# 08 · Circuito de Rutas HTTP — API Signup/Login

**Stack**: Node.js · Express 5 · TypeScript · Clean Architecture
**Estado**: Documenta el recorrido completo de una request por la capa `src/api/` — qué middleware corre, en qué orden, quién responde y quién traduce errores. Complementa `03-openapi.yaml` (formas) y `00-consideraciones-tecnicas.md` (decisiones transversales ítems 11-12, 20, 24, 41).

---

## 1. Cadena de middlewares (orden real en `src/index.ts`)

```
Request
  → helmet                            [cabeceras de seguridad]
  → cors                              [origen permitido por config.corsOrigins]
  → pinoHttp (httpLoggerConfig)       [genReqId: x-request-id \| req_<uuid>; log por request]
  → requestIdMiddleware               [req.requestId + AsyncLocalStorage run()]
  → express.json({ limit: '16kb' })   [parsea body; error → salta directo al handler final]
  → apiRouter (montada en /api/v1)
      → ruta específica + guarda (authLimiter | requireAuth)
          → handler (zod → use case → { data })
      → middleware 405 (ruta existe, método no soportado)
  → notFound                          [404 centralizado]
  → finalErrorHandler                 [405 → malformado → ApiError → ZodError → 500]
```

Regla del circuito: **los 3 primeros middlewares corren antes del parseo de body**, por lo que
cualquier error posterior (JSON inválido, oversize, 401, 422, 500) ya tiene `requestId`
disponible para el envelope de error.

---

## 2. requestId: generación, validación y propagación

| Etapa | Quién | Qué hace |
|---|---|---|
| Generación | `pinoHttp` → `genReqId` | Toma `x-request-id` del header **solo si** matchea `^[A-Za-z0-9_-]{1,64}$` (anti log-poisoning); si no, `req_<uuid>`. |
| Propagación | `requestIdMiddleware` | Copia `req.id` → `req.requestId` y ejecuta el resto de la cadena dentro de `context.run({ requestId }, next)` (ALS). |
| Consumo | handlers y `finalErrorHandler` | Inyectado en todo envelope `{ error: { requestId } }`; enriquecimiento de logs de la capa app vía ALS. |
| Fallback del handler final | `finalErrorHandler` | `req.requestId ?? 'req_<uuid>'` — nunca un envelope de error sin id. |

El `handler` del rate limit responde 429 con el mismo `req.requestId` (ya propagado por el
middleware #4), manteniendo el envelope idéntico al resto.

---

## 3. Rutas declarativas y asignación de handlers

`src/api/routes.ts` es solo montaje: cada ruta recibe su guarda y un handler construido por
`buildHandlers(useCases, deps)`. La lógica de negocio vive en la capa app (`useCases`),
la de presentación en `src/api/handlers/`.

| Ruta | Guarda | Handler → Use case |
|---|---|---|
| `POST /auth/register` | `authLimiter` | authRegister → `registerUser` |
| `POST /auth/login` | `authLimiter` | authLogin → `login` |
| `POST /auth/refresh` | `authLimiter` | authRefresh → `refreshTokens` |
| `POST /auth/logout` | `authLimiter` | authLogout → `logout` |
| `POST /auth/google` | `authLimiter` | authGoogle → `loginGoogle` |
| `POST /auth/magic-link/request` | `authLimiter` | magicLinkRequest → `requestMagicLink` |
| `POST /auth/magic-link/consume` | `authLimiter` | magicLinkConsume → `consumeMagicLink` |
| `GET /auth/me` | `requireAuth(tokens)` | me → `getMe` |

**Guarda por método**: los 7 endpoints `POST /auth/*` comparten `authLimiter`
(window/limit desde `config.rateLimit`, ítems 41 y 48-49 de doc 00). El único GET
(`/auth/me`) usa `requireAuth`, que valida access token (firma, exp, sub) y deja
`req.userId`.

---

## 4. Errores: 405 vs 404 y el middleware de método no permitido

Express 5 **no** emite `method_not_allowed` por sí solo cuando la ruta existe pero el
método no. El circuito lo resuelve con un middleware al final del router (ítem 24):

```
POST /auth/me/        → ruta GET existe, método no → middleware 405
normalización: req.path '/auth/me/' → '/auth/me' (trailing slash)
→ ALLOWED_METHODS['/auth/me'] = ['GET'], POST ∉ → next(err type=method_not_allowed) → 405

POST /auth/desconocido → no está en ALLOWED_METHODS → next() → notFound → 404
```

Clasificación final en `finalErrorHandler`:

| Señal | Código → Status |
|---|---|
| `err.type === 'method_not_allowed'` | `METHOD_NOT_ALLOWED` → 405 |
| `err.type ∈ { entity.parse.failed, entity.too.large }` | `MALFORMED_REQUEST` → 400 |
| `err instanceof ApiError` | `{ code → status }` — el ÚNICO mapeo código→HTTP (dominio no conoce HTTP) |
| `err instanceof ZodError` | `VALIDATION_ERROR` → 422 + `details[]` (field → issue) |
| resto (inesperado) | `INTERNAL_ERROR` → 500, sin stack traces |

Nota: el dominio lanza errores con código; quién traduce a status HTTP es SIEMPRE
`finalErrorHandler` (STATUS_BY_CODE). El rate limiter y el 405 escriben su respuesta
directamente porque son frontera pura.

---

## 5. Uniformidad de la capa de presentación

Todo endpoint sigue el mismo contrato de handler (`src/api/handlers/*`):

1. **Parse de frontera** con zod (`schemas.ts`) → 422 en fallo.
2. **Delegación al use case** — la capa app (`src/app/useCases/`) ejecuta la lógica.
3. **Respuesta envelope** `{ data }` (201 register, 204 logout, 200 resto).
4. **Cualquier error → `next(err)`** → cae al handler final.

`GET /auth/me` no es excepción: aunque su caso de uso (`getMe`) es una lectura simple,
pasa por la misma caja para que NINGÚN handler acceda a repositorios directamente
(`deps.users.findById` no se usa fuera de la capa app).

---

## 6. Zonas de riesgo documentadas (decisiones deliberadas)

1. **Rate limit por instancia**: `express-rate-limit` usa store en memoria — el límite
   es por proceso. Con 2+ réplicas detrás de un LB, el límite efectivo se multiplica.
   Aceptable single-instance; revisar (Redis store) al escalar.
2. **`x-request-id` confiable solo si el proxy no lo sobreescribe**: si un front
   arbitrario puede inyectarlo, el valor se valida (pattern + 64) pero no se autentica.
3. **`/auth/me/` (trailing slash)**: normalizado a `/auth/me` en el middleware 405
   (misma ruta). Las respuestas NO redirigen (301/308) — el contrato no lo exige.