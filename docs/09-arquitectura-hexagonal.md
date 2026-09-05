# 09 · Arquitectura Hexagonal — Puertos y Adaptadores

**Stack**: Node.js · Express 5 · TypeScript · Clean Architecture
**Estado**: Generado desde el índice codegraph (`.codegraph/codegraph.db`, nodos `interface`/`class` + aristas `implements`). Muestra qué adaptador de `src/infra/` (y qué fake de `test/`) implementa cada puerto definido en `src/domain/port/`. Complementa `00-consideraciones-tecnicas.md` (decisión de puertos y adaptadores) y `04-modelo-de-datos.md`.

```mermaid
flowchart LR
    subgraph DOM["src/domain/port/ — puertos (interfaces)"]
        direction TB
        P_EMAIL["«interface» EmailSender"]:::port
        P_GOOGLE["«interface» GoogleIdTokenVerifier"]:::port
        P_LOGGER["«interface» Logger"]:::port
        P_MAGIC["«interface» MagicLinkRepository"]:::port
        P_PASS["«interface» PasswordHasher"]:::port
        P_TOKEN["«interface» TokenIssuer"]:::port
        P_USER["«interface» UserRepository"]:::port
    end

    subgraph INFRA["src/infra/ — adaptadores (producción)"]
        direction TB
        A_EMAIL["ConsoleEmailSender"]:::adapter
        A_GOOGLE["GoogleIdTokenVerifierJose"]:::adapter
        A_LOGGER["PinoLogger"]:::adapter
        A_MAGIC["DrizzleMagicLinkRepository"]:::adapter
        A_PASS["Argon2PasswordHasher"]:::adapter
        A_TOKEN["JoseTokenService"]:::adapter
        A_USER["DrizzleUserRepository"]:::adapter
    end

    subgraph TEST["test/ — fakes (dobles de prueba)"]
        direction TB
        T_EMAIL["FakeEmailSender"]:::fake
        T_GOOGLE["FakeGoogleVerifier"]:::fake
    end

    A_EMAIL -. implements .-> P_EMAIL
    T_EMAIL -. implements (test) .-> P_EMAIL
    A_GOOGLE -. implements .-> P_GOOGLE
    T_GOOGLE -. implements (test) .-> P_GOOGLE
    A_LOGGER -. implements .-> P_LOGGER
    A_MAGIC -. implements .-> P_MAGIC
    A_PASS -. implements .-> P_PASS
    A_TOKEN -. implements .-> P_TOKEN
    A_USER -. implements .-> P_USER

    classDef port fill:#e8f0fe,stroke:#4285f4,stroke-dasharray:4 3
    classDef adapter fill:#e6f4ea,stroke:#188038
    classDef fake fill:#fef7e0,stroke:#f9ab00
    class P_EMAIL,P_GOOGLE,P_LOGGER,P_MAGIC,P_PASS,P_TOKEN,P_USER port
    class A_EMAIL,A_GOOGLE,A_LOGGER,A_MAGIC,A_PASS,A_TOKEN,A_USER adapter
    class T_EMAIL,T_GOOGLE fake
```

> Versión estática: [`09-arquitectura-hexagonal.svg`](09-arquitectura-hexagonal.svg) · fuente: [`09-arquitectura-hexagonal.mmd`](09-arquitectura-hexagonal.mmd)

## Lectura

| Puerto (interfaz) | Adaptador producción | Fake en test | Tecnología |
|---|---|---|---|
| `EmailSender` | `ConsoleEmailSender` | `FakeEmailSender` | email out (consola en dev) |
| `GoogleIdTokenVerifier` | `GoogleIdTokenVerifierJose` | `FakeGoogleVerifier` | verificación id_token Google (jose) |
| `Logger` | `PinoLogger` | — | pino |
| `MagicLinkRepository` | `DrizzleMagicLinkRepository` | — | Drizzle ORM → SQLite |
| `PasswordHasher` | `Argon2PasswordHasher` | — | argon2id |
| `TokenIssuer` | `JoseTokenService` | — | JWT HS256 (jose) |
| `UserRepository` | `DrizzleUserRepository` | — | Drizzle ORM → SQLite |

Regla hexagonal: **`src/app/` y `src/domain/` dependen solo de las interfaces**; los adaptadores de `infra/` se inyectan en `app/buildUseCases.ts` (ver doc 10 para el circuito completo). Los fakes permiten que `test/` ejercite los use cases sin infraestructura real.

## Fuente / Datos

Snapshot del working tree actual (último commit `0ec8de8` + refactor sin commitear):
- **Origen**: índice `.codegraph/codegraph.db` — 677 nodos · 1717 aristas · 70 archivos
- **Extracción**: aristas `implements` (9) entre nodos `interface`/`class`
- **Render**: Mermaid CLI (`mmdc` 11.6.0) con Chrome del sistema → `.svg`
- **Convención**: este `.md` es la fuente canónica; [`09-arquitectura-hexagonal.mmd`](09-arquitectura-hexagonal.mmd) y `.svg` se regeneran desde su bloque `mermaid`