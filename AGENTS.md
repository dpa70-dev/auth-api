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

## 3. SDD — el contrato es la fuente de verdad

- La especificación OpenAPI (`docs/03-openapi.yaml`) se escribe **antes** del código y define el comportamiento externo. Documento de referencia: docs/00 → §1.1.
- `src/api/contract.ts` se **genera** desde el yaml (`npm run contract`). No se edita, no se importa desde dominio, no se commitea a mano.
- Ningún endpoint se implementa sin su especificación previa con sus códigos de respuesta.
- Los `SuccessStatus`/`ErrorStatus` en `src/api/protocol/contractStatus.ts` se derivan del contrato (mapped types + `Is2xx`/`Is4xx5xx`). Si el contrato no declara algún status (p. ej. `404`/`405` son del middleware central), se añaden explícitamente como unión documentada.

## 4. Principios de código (doc 00 → §1.3, §10)

- **Símbolo dominante = nombre del archivo**: `apiError.ts` → `ApiError`; `logger.ts` → `Logger`. Un archivo = una responsabilidad; ≤ 250 LOC; sin `*Service` genéricos ni "kitchen sinks".
- **Funciones pequeñas** (~≤ 30 líneas), una sola cosa, sin parámetros booleanos con flag.
- **Comentarios solo para el "porqué"**: decisión de negocio o contexto no evidente; nunca re-explicar el qué. JSDoc redundante que repite la firma = eliminarlo.
- **Tipos que excluyen estados ilegales**: uniones discriminadas, VOs brandeados con Zod; el compilador hace imposible el estado inválido.
- **Cero `any` / `@ts-ignore` / `@ts-expect-error` / `as any`** — política del proyecto (doc 00 → §2.4, §10.3).
- **DRY con juicio**: abstraer en la tercera repetición (regla de tres); YAGNI. **No duplicar tipos idénticos en paralelo** (doc 05 → Fase 5).
- **No re-exportar tipos que no creaste** (doc 05 → Fase 4): cada archivo importa cada tipo de donde vive.
- **Errores explícitos y tipados**: jerarquía `AppError` + catálogo en `domain/errorCatalog.ts` (fuente única del vocabulario). Sin `catch {}` vacíos, sin excepciones mudas. Los use cases lanzan errores de dominio y no saben de HTTP; el middleware central mapea al envelope.
- Respuestas por helpers centrales tipados (`writeSuccess`/`writeError`), nunca dispersas en handlers.
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