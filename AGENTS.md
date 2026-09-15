# AGENTS.md — API Signup/Login

Reglas de trabajo para agentes de IA en este repo. Derivadas de `docs/00-consideraciones-tecnicas.md`, `docs/05-qa-verificacion-arquitectura.md` y la convención real del historial git. **Leer este archivo antes de tocar código.**

---

## 1. Stack y runtime

| Pieza | Versión | Nota |
|---|---|---|
| Node.js | 24 LTS (`engines` + `.nvmrc`) | TypeScript ejecutado directo por Node (type-stripping), sin build previo |
| TypeScript | 7.x | `strict: true` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` |
| Express | 5 | Errores async propagan solos; `*` → `*splat` |
| SQLite | better-sqlite3 | `node:sqlite` descartado (Stability 1.2) |
| ORM | Drizzle | Driver better-sqlite3 |
| Validación | Zod 4 | VOs brandeados en el dominio; *parse, don't validate* |
| Logging | pino + pino-http | `console.log` prohibido (ver §4) |
| Tokens | jose | Access Bearer + refresh rotable (cookie httpOnly + body) |
| Hashing | argon2id | Parámetros OWASP m=19456, t=2, p=1 |
| Tests | Vitest 4 + Supertest | e2e contra SQLite en archivo temporal |

## 2. Arquitectura (Clean Architecture estricta)

```
src/
├── domain/       ← entidades, VOs, reglas de negocio, puertos. NO importa nada externo.
├── app/          ← useCases, helpers, interfaces. Depende solo del dominio.
├── infra/        ← adapters: repos, db, hasher, tokens, logger (pino), unit of work.
│                   ÚNICA capa que importa librerías concretas (Express NO).
├── api/          ← presentación: routes, handlers, middlewares, protocol, contract.ts.
│   └── contract.ts ← generado: `npm run contract` (openapi-typescript). NUNCA editar a mano.
└── db/           ← esquemas Drizzle y migraciones.
```

**Regla fundacional**: la dependencia apunta **hacia adentro** — `domain ← app ← infra/api`. El dominio jamás importa Express, SQLite, pino, ni artefactos generados (`contract.ts`). "El contrato se conforma al dominio, no al revés."

Mantras del proyecto (doc 05): *"el dominio no conoce a nadie externo"*, *"cada archivo exporta lo que crea"*, *"unir cabos / single source of truth"*.

### 2.1 SOLID (mapeado a Clean Architecture, doc 00 → §1.2)

| Principio | Cómo se aplica en este proyecto |
|---|---|
| **S** — Single Responsibility | Un módulo = una responsabilidad: handler / use case / repositorio separados. ≤ 250 LOC por archivo; sin "God classes" ni `*Service` genéricos. |
| **O** — Open/Closed | Extensiones sin modificar el core: cambiar el proveedor de hashing o de DB (SQLite → Postgres) implica **añadir un adaptador**, nunca tocar el dominio. |
| **L** — Liskov | Implementaciones sustituibles: repos en memoria (tests) y SQLite (producción) se intercambian sin cambiar quien las usa. |
| **I** — Interface Segregation | Puertos pequeños y específicos: el use case pide solo lo que necesita (`findByEmail`, `save`), no un CRUD gigante. |
| **D** — Dependency Inversion | El dominio depende de **puertos** (interfaces), nunca de librerías concretas ni de Express. Inyección por constructor en los use cases (DIP). |

## 3. SDD — el contrato es la fuente de verdad

- La especificación OpenAPI (`docs/03-openapi.yaml`) se escribe **antes** del código y define el comportamiento externo. Documento de referencia: docs/00 → §1.1.
- `src/api/contract.ts` se **genera** desde el yaml (`npm run contract`). No se edita, no se importa desde dominio, no se commitea a mano.
- Ningún endpoint se implementa sin su especificación previa con sus códigos de respuesta.
- Los `SuccessStatus`/`ErrorStatus` en `src/api/protocol/contractStatus.ts` se derivan del contrato (mapped types + `Is2xx`/`Is4xx5xx`). Si el contrato no declara algún status (p. ej. `404`/`405` son del middleware central), se añaden explícitamente como unión documentada.

## 4. Principios de código Clean Code (doc 00 → §1.3, §10)

- **P-01 — Nombres con intención**: `RegisterUserUseCase`, `hashPassword`, `findByEmail` — el nombre comunica propósito y nivel de abstracción, no mecanismo.
- **P-02 — Funciones pequeñas**: una sola cosa (~≤ 30 líneas), sin efectos ocultos, sin parámetros booleanos que cambian el flujo (flag envy → dividir la función).
- **P-03 — Comentarios solo para el "porqué"**: decisión de negocio o contexto no evidente; nunca re-explicar el qué. JSDoc redundante que repite la firma = eliminarlo.
- **P-04 — Tipos que excluyen estados ilegales**: uniones discriminadas, VOs brandeados con Zod; el compilador hace imposible el estado inválido.
- **P-05 — DRY con juicio**: abstraer en la tercera repetición (regla de tres); YAGNI. **No duplicar tipos idénticos en paralelo** (doc 05 → Fase 5).
- **P-06 — Errores explícitos y tempranos**: fallar rápido en el borde; sin excepciones mudas, `catch` vacíos ni conversiones `any`/`@ts-ignore`.
- **Símbolo dominante = nombre del archivo**: `apiError.ts` → `ApiError`; `logger.ts` → `Logger`. Un archivo = una responsabilidad; sin "kitchen sinks".
- **Cero `any` / `@ts-ignore` / `@ts-expect-error` / `as any`** — política del proyecto (doc 00 → §2.4, §10.3).
- **No re-exportar tipos que no creaste** (doc 05 → Fase 4): cada archivo importa cada tipo de donde vive.
- **Errores tipados por catálogo**: jerarquía `AppError` + catálogo en `domain/errorCatalog.ts` (fuente única del vocabulario). **El código de error jamás se instancia con literales hardcodeados** — `new ApiError('INVALID_CREDENTIALS')` es ilegal en un call-site; el código proviene del catálogo (doc 05 → Fase 1). Los use cases lanzan errores de dominio y no saben de HTTP; el middleware central mapea al envelope.
- Respuestas por helpers centrales tipados (`writeSuccess`/`writeError`), nunca dispersas en handlers.
- **Unit of Work (doc 13 → §13.1)**: en use cases multi-escritura, `BEGIN`/`COMMIT` solo alrededor de las escrituras, **nunca** alrededor de llamadas lentas o de red — verificar/hashear/generar crypto **fuera** de la tx, envolver solo los inserts/updates con `unitOfWork.withTransaction`. Con better-sqlite3 la tx es de alcance de conexión: `fn` no recibe repos "transaccionales" (serían no-op). Implementado en `RegisterUser`, `ConsumeMagicLink`, `ResetPassword`.
- **Logging**: pino, prohibido `console.log` (eslint lo bloquea; solo se permite `console.error` para fallos fatales previos al logger). Redactar datos sensibles; el dominio no loggea por su cuenta (puerto `Logger`).
- **Env validado con schema al arranque**; nunca `process.env` disperso.

## 5. Testing y calidad (doc 00 → §10)

- Runner: **Vitest** (tests ubicados en `test/`). Supertest para integración HTTP; SQLite en **archivo temporal**, nunca `:memory:`.
- Pirámide: VOs/dominio (unit) → rutas (integración) → e2e del flujo completo.
- **Gates obligatorios antes de merge** (y antes de reportar "listo"):
  ```bash
  npx tsc --noEmit
  npx eslint src/ test/
  npx vitest run
  ```
- Estado actual: 106 tests en 11 archivos. Si una feature añade tests, actualizar también el conteo en los docs afectados si lo mencionan (doc 05 → §10/§15).
- CI mínimo documentado: typecheck + lint + test + `npm audit`.

## 6. Flujo de trabajo git

- **Convención de commits — español, Conventional Commits**: `tipo(scope): descripción`.
  - Tipos vistos en el historial: `feat`, `fix`, `docs`, `test`, `refactor`, `build`/`chore`, `merge`.
  - Scopes: `api`, `app`, `domain`, `infra`, `db`, `docs`, `qa`, `test`, `contract`, `auth`, etc.
  - Ejemplos reales: `feat(api): status codes derivados del contrato OpenAPI en success/error.ts` · `docs(qa): anotar conteos de vitest en docs/05`.
- **Features van en rama `feat/<slug>` → merge `--no-ff` a `main`** con mensaje `merge(feat/<slug>): ...`. El historial mantiene las ramas mergeadas (no se borran por defecto; preguntar).
- No commitear directo en `main` trabajo de feature (lección aprendida con `feat/contract-typed-api`).
- **NUNCA commitear**: `.omo/` (artefactos del orquestador), `.env`, `*.sqlite`, `dist/`, `data/`, `patches/`, `exports/`. Ver `.gitignore`.
- El dominio es autónomo del contrato; ante un cambio de contrato, regenerar `contract.ts` (`npm run contract`) y dejar que `tsc` detecte el drift.

## 7. Cómo trabajar como agente

- **Primero leer**: este archivo, luego `docs/00` (decisiones técnicas), `docs/05` (QA/arquitectura) según la zona a tocar.
- Al implementar una feature nueva: consultar `docs/01-historias-de-usuario.md` y `docs/03-openapi.yaml` antes de escribir handlers.
- Trabajo multi-paso: usar todo list. Cada cambio verificado con los gates de §5 antes de reportar.
- Si un cambio contradice una decisión documentada de doc 00/05, plantearlo antes de implementar — no "arreglarlo" silenciosamente.
- La documentación (`docs/`) es parte del entregable: features → su sección en docs se actualiza/marca como implementada (mismo patrón ya usado: "implementado (fecha) — N tests en verde").

## 8. Patrones de diseño (docs/09 y docs/13)

### Ya implementados — reconocerlos, no reinventarlos

| Patrón | Dónde vive | Regla asociada |
|---|---|---|
| Ports & Adapters | Puertos en `domain/port/`, adaptadores en `infra/`, fakes en `test/` (doc 09) | `app/` y `domain/` dependen solo de interfaces; los adaptadores se inyectan en compose |
| Strategy | `TokenIssuer`, `PasswordHasher` (doc 13.6) | Proveedor nuevo = **adaptador nuevo**, jamás tocar el dominio |
| Repository | `UserRepository`, `MagicLinkRepository` | Puertos pequeños y específicos (§2.1 — I) |
| Unit of Work | `domain/port/unitOfWork.ts` + `infra/sqliteUnitOfWork.ts` (§4) | tx solo alrededor de escrituras |
| Value Objects brandeados | `domain/vo/` con Zod (§1) | *parse, don't validate* |

### Catálogo de candidatos — documentados, NO implementar de motu proprio

| # | Patrón | Nota |
|---|---|---|
| 13.2 | `asyncHandler` (Template Method) | Esqueleto repetido de handlers — espera en la guía |
| 13.3 | Transactional Outbox | Emails fiables — cuando entre SMTP real |
| 13.4 | Domain Events (Observer) | **Solo con ≥2 consumidores por evento** — hoy el vocabulario `logEvents` basta inline |
| 13.5 | Circuit Breaker | Resiliencia ante caída de Google |

Guía completa y orden de implementación en `docs/13-patrones-a-sumarr.md` — **consultarla antes de añadir cualquiera** de estos patrones.