# Todos — Fase 3 (Implementación)

## Fase 1-2 (completada)
- [x] docs/00-04 creadas, auditadas y corregidas (01 historias, 02 casos de uso, 03 OpenAPI, 04 modelo de datos)
- [x] modelado de datos: ERD + DDL (CHECKs, FKs) en docs/04, coincide con el esquema de la BD

## Fase 3 — Implementation (pasos 1-26 completados, paso 27 pendiente)
- [x] scaffolding: package.json, tsconfig strict + build, eslint flat, scripts dev/build/test/typecheck/lint/contract, .env.example
- [x] deps runtime (express@5, better-sqlite3, drizzle-orm, drizzle-kit, jose, argon2, zod, pino en package.json, helmet, cors, express-rate-limit, dotenv) + dev (typescript 5.9.3 pin, tsx, vitest, openapi-typescript, typescript-eslint)
- [x] src/contract.ts generado con openapi-typescript desde docs/03-openapi.yaml
- [x] src/config.ts: .env parseado con zod 4, Config tipada
- [x] src/api/envelope.ts: envelope {data}|{error:{code,message,details?,requestId}} + ERROR_CODES (11 códigos) + ValidationIssue
- [x] src/domain/vo/index.ts: 8 VOs brandeados zod 4 (Email, PlainPassword, PasswordHash, UserId, Jti, GoogleSub, Provider, EmailVerified)
- [x] src/domain/entity/index.ts: User/NewUser/StoredRefreshToken, timestampSchema ISO
- [x] src/domain/error.ts: ApiError con code/detail y tipos (códigos del contrato)
- [x] src/domain/port/index.ts: PasswordHasher, TokenIssuer, Logger, GoogleClaims, GoogleIdTokenVerifier, UserRepository (+findById), UserRecord, InsertRefreshToken con familyId
- [x] src/app/registerUser.ts: US-01/US-08, colisión 409 con details provider, passwordHash null→409
- [x] src/app/login.ts: US-02 anti-enumeración (hash ficticio), 401 genérico
- [x] src/app/refreshTokens.ts: US-03 rotación, reuso→revocar familia→401, token opaco + jti hash
- [x] src/app/logout.ts: US-04 soft-revoke (status=revoked), 204
- [x] src/app/loginGoogle.ts: US-07/US-08 alta implícita, e-mail_verified, colisión 409 local, sin auto-linking; loginGoogle null→500 INTERNAL_ERROR si no configurado
- [x] src/app/authMiddleware.ts: requireAuth HS256 access JWT, expiración, req.userId
- [x] db/schema.ts miles 1:1 con docs/04 (users, refresh_tokens, CHECKs, FKs user_id + family_id) + migración drizzle-kit 0000_rare_blue_marvel.sql verificada
- [x] src/infra/argon2PasswordHasher.ts: argon2id m=19456 t=2 p=1, hash ficticio lazy anti-enumeración
- [x] src/infra/joseTokenService.ts: HS256 access TTL config, refresh opaco 32B base64url + jti, sha256 hex
- [x] src/infra/drizzleUserRepository.ts: queries diagrama 3, revokeFamily por family_id
- [x] src/infra/pinoLogger.ts: logger JSON auto-contenido
- [x] src/infra/googleJwtVerifier.ts: JWKS remoto, RS256, aud/iss, email_verified
- [x] src/api/errorMiddleware.ts: requestId, ZodError→422, body-parser→400 MALFORMED_REQUEST, 405 Express 5, notFound 404, 500 genérico sin stack
- [x] src/api/routes.ts: 6 rutas (5 POST auth + GET /auth/me), authLimiter 429 Retry-After, schemas zod frontera, emisor explícito 405 (Express 5 no emite solo)
- [x] src/index.ts: buildApp + AppDeps inyectables (db/google/logger), graceful shutdown, auto-run off en NODE_ENV=test
- [x] test/e2e.test.ts + vitest.setup.ts + vitest.config.ts: 23 tests e2e por historia US-01..08 + transversales (422/400/404/405/409/429/requestId) — **23/23 pasan**
- [x] verificación: tsc --noEmit limpio, eslint 0 errores (no-namespace allowDeclarations), build OK
- [x] smoke: npm run dev + curl de register→login→me→refresh→reuso→logout→404/405/422/400— respuestas conforme contrato 03

## Pendiente — paso 27 (cierre)
- [x] actualizar docs (estado fase 3 en 00/02/04), .env.example final verificado contra config.ts, ntfy hito enviado, resumen final

## Fase 3 — COMPLETADA (29-ago-2026)
- Todos los pasos 1-27 cerrados: 23/23 tests e2e en verde, tsc/eslint/build limpios, smoke curl conforme al contrato 03.