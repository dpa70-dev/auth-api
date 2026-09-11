# 06 · Recomendaciones — Transporte de tokens y sesiones multi-frontend — API Signup/Login

**Stack**: Node.js · Express · TypeScript · Clean Architecture · SQLite · Drizzle · JWT · UUID · argon2 · jose · OIDC (Google)

**Estado de este documento**: Registro de **recomendaciones** (comentarios y observaciones) sobre el transporte de tokens entre cliente y API, y sobre el modelo de sesiones cuando el **mismo usuario se autentica desde múltiples frontends** (web, móvil, CLI). Complementa las decisiones vinculantes de `00-consideraciones-tecnicas.md` (ítems 38–42, 47–48), el modelo de datos de `04-modelo-de-datos.md` (decisión 2) y el registro del QA en `05-qa-verificacion-arquitectura.md` (§11).

**Propósito clave de este documento**: distinguir explícitamente **lo que está implementado hoy** (decisión adoptada, válida y suficiente) de **lo que se recomienda hacer en escenarios concretos** (app web en producción, operación multi-dispositivo real). Que el lector no confunda la implementación actual con el estado del arte ni con la recomendación para su caso.

**Metodología**: Análisis de la implementación en `src/` (middleware de autenticación, rutas de refresh/logout, configuración CORS en `index.ts`) contrastado con las recomendaciones vigentes de OWASP (transporte de tokens, amenazas XSS/CSRF) y el patrón de rotación de refresh ya documentado en el ítem 38 de `docs/00`. Este documento **no introduce cambios de código**: es guía de integración y de evolución futura.

---

## 1. Propósito y alcance

Este documento responde a tres preguntas que surgen al integrar la API desde distintos clientes:

1. **¿Cómo se autentica un cliente contra la API hoy?** → `Authorization: Bearer` para el access token; el refresh token viaja en el body de `/auth/refresh` y `/auth/logout`. Sin cookies. (Sección 2.)
2. **¿Cuál es la mejor forma de autenticar una app web (SPA)?** → Access token en `Authorization: Bearer` (guardado en memoria), refresh token en **cookie httpOnly + Secure + SameSite=Lax**. (Sección 3.)
3. **¿Cómo se atiende al mismo usuario desde varios frontends a la vez (web + móvil) con sesiones y logouts independientes?** → El modelo de datos debe usar **un `family_id` por sesión**, no uno por usuario. (Sección 5.)

La lectura recomendada es: secciones 2 (qué hay), 3 y 4 (qué hacer según cliente) y 5 (qué hacer si hay múltiples frontends).

---

## 2. Lo que está implementado hoy (decisión adoptada)

> **Actualizado (11-sep-2026)**: la API implementa **transporte dual** — access por Bearer + refresh por **cookie httpOnly (web)** con **emisión dual** (la respuesta también devuelve el refresh en el body) y **doble lectura** (cookie primero, body después) en `/auth/refresh` y `/auth/logout`. CORS con allowlist y `credentials: true`. El cliente móvil puede seguir usando el body indistintamente (ver §3.3 y §4).

### 2.1 Access token → `Authorization: Bearer`

El access token (JWT de corta vida, 5–15 min, firma HS256 con `jose`) se envía en cada request a los endpoints protegidos mediante el header:

```
Authorization: Bearer <accessToken>
```

- Lo verifica un **middleware propio** (`requireAuth`) que parsea el header, valida la firma y los claims (`exp`, `sub`), y rechaza con `401` si falta, está malformado o expiró.
- **Por qué es correcto**: es el transporte estándar de la industria, **stateless** (el servidor solo valida la firma, no guarda sesión en memoria), no depende de cookies y, por tanto, no introduce superficie CSRF.
- Es agnóstico del cliente: funciona idéntico en navegador, app móvil nativa, CLI o scripts.

### 2.2 Refresh token → body del request (mejor que Bearer)

El refresh token (opaco, larga vida 7–30 días, **guardado hasheado en DB** con su `jti`) viaja en el **body JSON** de los endpoints que lo consumen:

- `POST /api/v1/auth/refresh` → recibe el refresh y emite un par nuevo (rotación, ítem 38 de `docs/00`).
- `POST /api/v1/auth/logout` → recibe el refresh y lo revoca (borrado de DB).

**Por qué el body, no Bearer**: el refresh **nunca debe enviarse como `Authorization: Bearer`**. No es una opinión, es un anti-patrón de seguridad con tres razones concretas:

1. **Los headers `Authorization` se loguean por defecto en la infraestructura.** nginx, Apache, CDNs, load balancers, proxies, herramientas de observabilidad (Datadog, ELK) loguean `Authorization` en sus access logs. Un refresh token de 30 días quedaría registrado en disco en cada petición de renovación/logout. Si hay un breach de logs, el atacante tiene refresh tokens válidos y persistentes. El access token también se loguea, pero su vida corta acota el daño; el refresh es de larga vida y alto valor.

2. **Ambigüedad con el access token.** RFC 6750 define Bearer como mecanismo para el credencial que se usa **en cada request** (el access token). Meter el refresh en el mismo header crea ambigüedad: un middleware que lee `Authorization` no puede distinguir si le llegó un access (corto, se valida con `exp`) o un refresh (largo, se valida en DB). Eso complica la lógica de verificación y abre puertas a errores de implementación.

3. **Riesgo de que viaje en requests equivocados.** Si el cliente envía el refresh como Bearer en requests a endpoints protegidos, el middleware lo procesaría como access — y, si el refresh es válido (larga vida), podría aceptarlo como credencial de acceso. Eso rompe el modelo de seguridad: un token diseñado para renovar la sesión se convierte en credencial de acceso de larga vida.

**El body es la segunda mejor opción después de la cookie httpOnly** (§3): explícito, no se loguea por defecto por la infraestructura, no hay ambigüedad con el access, y el cliente controla el envío. Con el transporte dual de esta iteración, **el móvil/CLI/scripts siguen usando exclusivamente el body** — la cookie solo se emite/lée cuando el navegador la envía (el body queda opcional, ver §3.3).

### 2.3 Cookies en la API (CORS con `credentials`)

La API **setea y lee una única cookie**: `refresh_token` (httpOnly, `Secure` en prod, `SameSite=Lax`, `Path=/api/v1/auth`, `Max-Age` = TTL del refresh). Se emite en `register`, `login`, `login/google`, `consume-magic-link` y `refresh` (rotación); se elimina en `logout`; se lee en `refresh` y `logout` con **prioridad sobre el body**:

```ts
// index.ts
app.use(cors({ origin: cfg.corsOrigins, credentials: true })); // allowlist estricta
app.use(cookieParser());
```

- La **emisión es dual**: la respuesta JSON **siempre** incluye el refresh en el body (contrato: `authTokens.refreshToken`, el cliente móvil no depende de cookies), y **además** se setea la cookie httpOnly para el navegador. **No hay detección de cliente**: los dos canales se materializan siempre.
- La **lectura es cookie-first**: `readRefreshCookie(req) ?? body.refreshToken`. El campo `refreshToken` del body es **opcional** en el contrato (OpenAPI `RefreshRequest.refreshToken?`); sin cookie y sin body → `401` genérico.
- El **access token jamás viaja por cookie**: el middleware `requireAuth` solo acepta `Authorization: Bearer` (única fuente).
- **CSRF**: mitigado con `SameSite=Lax` + exigencia de `Content-Type: application/json` (`express.json`: los requests cross-site con body JSON requieren preflight CORS y quedan bloqueados). No se usa token CSRF (decisión: ítem 48 de `docs/00`).
- **Consecuencia de diseño**: el riesgo de XSS (robo de token vía `localStorage`) se reduce para el refresh (inmune a XSS en la cookie); el access sigue siendo responsabilidad del cliente (guardarlo en memoria, §3.1). Decisión deliberada (ítem 39 de `docs/00`, actualizado 11-sep-2026).

### 2.4 Resumen de la decisión adoptada

| Elemento | Transporte implementado | Dónde lo guarda el cliente |
|---|---|---|
| Access token | `Authorization: Bearer` (nunca cookie) | Decisión del cliente (ver §3 y §4) |
| Refresh token | **Cookie httpOnly** (web) **y** body — **emisión dual en todas las respuestas** | Navegador: cookie automática; móvil/CLI: body → almacenamiento seguro |
| Lectura refresh (`/auth/refresh`, `/auth/logout`) | **Cookie primero, body después** (body opcional) | — |
| Cookies | Una sola: `refresh_token` (httpOnly, Secure, SameSite=Lax) | — |
| CORS | Allowlist, `credentials: true` | — |

**Conclusión**: lo implementado cubre **ambos** clientes con una sola API: el web usa el patrón óptimo (§3) sin configuración especial, y el móvil el transporte body (§4). No hay branching por user-agent.

---

## 3. Recomendación para app web (SPA) — el patrón óptimo

Este es el mensaje central del documento: **para una app web, la mejor práctica es separar el transporte según la vida y el valor del token**, no usar cookie para todo ni Bearer para todo. **Esta sección describe el patrón ya implementado en la API** — el web no necesita hacer nada más allá de recibir las cookies que la API ya setea.

### 3.1 Access token → `Authorization: Bearer`, guardado en memoria (no en `localStorage`)

- El access token se envía **siempre** por header `Authorization: Bearer` (igual que hoy), pero el cliente web debe guardarlo en **memoria (JavaScript)** de la SPA, no en `localStorage` ni `sessionStorage`.
- **Por qué no `localStorage`**: cualquier vulnerabilidad XSS (input no sanitizado, dependencia comprometida) permite a un script leer `localStorage` y exfiltrar el token. Es el vector más común de robo de sesiones.
- **Por qué la memoria**: el token vive solo en el contexto JS actual. Si hay XSS le roba el **access de corta vida** (5–15 min), que se puede invalidar; no le expone el refresh (ver §3.2). El costo: **al recargar la página se pierde el access** — y eso está bien, porque se recupera automáticamente con el refresh token (flujo silencioso en el arranque de la app).
- **Nota**: poner el *access* en cookie httpOnly es un patrón **discutible y poco usado** en SPAs: el access viaja en cada request y reemitirlo desde cookie complica el middleware sin ganancia real (el refresh es el activo valioso, no el access). La recomendación es **no** usar cookie para el access.

### 3.2 Refresh token → cookie `httpOnly + Secure + SameSite=Lax`

El refresh token (el activo **de mayor valor**: larga vida y permite emitir nuevos access) debe vivir en una **cookie httpOnly** seteada por la API:

```
Set-Cookie: refresh_token=<refresh>; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth; Max-Age=... 
```

- **`HttpOnly`**: JavaScript **no puede leerla** — la cookie es invisible para scripts. Un XSS ya no puede exfiltrar el refresh. Esta es la inmunización contra el vector principal.
- **`Secure`**: solo se transmite por HTTPS.
- **`SameSite=Lax`**: la cookie no se envía en requests cross-site (mitiga CSRF en navegadores modernos); `Lax` permite el flujo de navegación top-level que una SPA pueda necesitar.
- **`Path` restringido** (p. ej. `/api/v1/auth`): la cookie solo viaja a los endpoints de auth, no a todo el dominio.

**El flujo resultante para la app web**:

1. `POST /auth/google` o `POST /auth/login` → 200 con access (JSON) **+ `Set-Cookie` con el refresh**.
2. Cada request autenticado → `Authorization: Bearer <access>` (desde memoria).
3. Access expira → `POST /auth/refresh` con la cookie (el navegador la envía sola) → 200 con access nuevo + **nueva cookie** (rotación).
4. Logout → `POST /auth/logout` con la cookie → 200 + cookie expirada/borrada.

### 3.3 Qué implica el patrón actual en la API (ya implementado)

La API ya implementa el patrón completo de cookie httpOnly para web:

- **`Set-Cookie` en `register`, `login`, `login/google`, `consume-magic-link` y `refresh`**: la cookie `refresh_token` (httpOnly, Secure en prod, SameSite=Lax, Path=`/api/v1/auth`) se emite en cada respuesta que genere un refresh, además de devolverlo en el body JSON (emisión dual — sin detectar cliente).
- **Doble fuente en `/auth/refresh` y `/auth/logout`**: la cookie tiene prioridad (`readRefreshCookie(req)` → si existe, se usa; si no, `req.body.refreshToken`). Para el móvil que no envía cookies, el body funciona exactamente igual. El campo `refreshToken` del body es `optional` en el contrato OpenAPI.
- **CORS** con `credentials: true` y la misma allowlist estricta (`corsOrigins` del config).
- **CSRF**: mitigado por `SameSite=Lax` + `Content-Type: application/json` (los requests cross-site con body JSON requieren preflight CORS y quedan bloqueados). No se usa token CSRF.
- El access **sigue por Bearer**, nunca en cookie.

**Nota para el cliente web**: las cookies las gestiona la API automáticamente (`credentials: 'include'` en fetch/axios para el mismo origen o la allowlist); la app solo debe guardar el **access** en memoria y llamar a `/auth/refresh` con la cookie cuando expire.

---

## 4. Recomendación para app móvil (nativa / React Native / Flutter)

Para el móvil, **lo implementado hoy es exactamente lo recomendado**: Bearer para el access y el refresh en el body.

- **No hay XSS en una app nativa**: no hay DOM ni scripts de terceros ejecutándose en el contexto de la app del mismo modo que en el navegador. El modelo de amenazas es distinto (dispositivo comprometido, malware, backup, extracción física).
- **Almacenamiento correcto**: los tokens deben guardarse en el **almacenamiento seguro del SO** — Keychain (iOS) / Keystore (Android) — **nunca** en almacenamiento plano (SharedPreferences, AsyncStorage sin cifrar, archivos sin ACL).
- **No aplicar el patrón cookie** al móvil: no aporta beneficio (no hay XSS que mitigar) y añade fricción (cookie jars HTTP frágiles en clientes HTTP de apps, problemas en WebViews, bloqueos en proxies). El móvil manda los tokens explícitamente.
- **Cuidado adicional**: si el usuario desinstala/reinstala la app, el Keychain/Keystore puede sobrevivir o no según el SO — el patrón de **rotación + detección de reuso** (ítem 38, `docs/00`) ya contempla refrescar desde cualquier cliente y revocar familias ante reuso.

**Resumen**: móvil → `Authorization: Bearer` para el access + refresh en body, con tokens en almacenamiento seguro del SO.

---

## 5. Múltiples frontends y sesiones independientes (`family_id` por sesión)

> **Actualizado (11-sep-2026)**: la recomendación de `family_id` por sesión **ya está implementada**. Esta sección describe el diseño actual (el logout ya es por sesión), y las subsecciones 5.1–5.3 se mantienen como trazabilidad de la evolución.

### 5.1 El problema que resolvió este cambio (logout global)

En la iteración anterior el modelo definía `family_id = user_id`, es decir, **la "familia" de refresh tokens coincidía con el usuario**: todos los refreshes emitidos para un usuario pertenecían a la misma familia. Consecuencias:

- `logout` (revocación de la familia) → revoca **todas** las sesiones del usuario, en **todos** los dispositivos.
- Detección de reuso de un refresh (token ya usado presentado de nuevo) → revoca también **toda** la familia → el usuario queda deslogueado **en todos** los frontends.

Para una fase 1 es **correcto y deliberado** (simple, con una única regla de revocación). Pero si el mismo usuario se autentica desde web **y** móvil (o varios dispositivos) a la vez, "cerrar sesión en el móvil" **también desloguea la web**. Ese comportamiento suele ser indeseable en producción.

### 5.2 La implementación: un `family_id` por sesión (UUID por login) — **implementado**

El `family_id` es un **UUID de sesión creado en cada login** (no el `user_id`):

```
Cada login (nuevo par access+refresh)  →  se crea una NUEVA familia con su propio family_id (UUID).
La rotación del refresh (refresh → par nuevo)  →  mantiene el MISMO family_id (padre → hijo).
```

- **Login en web** → familia A (web).
- **Login en móvil** → familia B (móvil).
- La rotación en web mantiene A; la rotación en móvil mantiene B.
- `logout` presentando el refresh de la familia A → **revoca solo A**. El usuario sigue logueado en el móvil (familia B).
- Reuso detectado en A → revoca solo A. B queda intacta.

**Regla de oro (ya aplicada en el código)**: la revocación por reuso se ejecuta por `family_id` → revoca **solo la sesión atacada**; la revocación global por usuario (`revokeAllForUser`) queda restringida a eventos de seguridad del usuario (cambio/reset de password — F1 de US-11/US-12). `family_id` identifica **una sesión/dispositivo**, no a la persona.

### 5.3 Cómo se implementó el cambio (aplicado el 11-sep-2026)

1. **Emisión**: `familyIdSchema.parse(crypto.randomUUID())` en cada alta de sesión (`issueSession` → login/register/google/magic) en vez de `user_id`; la rotación hereda `found.familyId` (padre → hijo).
2. **Puerto/implementación**: `revokeFamily(familyId)` recibe el `familyId` resuelto del refresh presentado (`findByRefreshTokenHash` ahora expone `familyId` y guarda `InsertRefreshToken.familyId`); reuso → `revokeFamily(found.familyId)` → solo esa sesión. Se añadió `revokeAllForUser(userId)` para los F1 de US-11/US-12 (cambio/reset de password revoca todas las familias del usuario).
3. **Contrato/API**: `logout` revoca la sesión/familia del token presentado (no existe `logoutAll` por diseño — fuera de alcance del plan; si se quisiera, el puerto ya tiene `revokeAllForUser` como base).
4. **Migración**: `0003_cloudy_lucky_pierre.sql` — se eliminó la FK `family_id → users(id)` (sin cambio de tipo); las sesiones previas con `family_id = user_id` quedan como familias de un solo uso y los nuevos logins generan su UUID.
5. **Trazabilidad**: sin campo `client`/`device` adicional (iteración futura, doc 01 → nº 161); el ítem 47 de `docs/00` (`provider` `local|google|magic`) sigue informando el origen.

### 5.4 Alternativa deliberada (por qué no logout global)

Si el producto quisiera **una sola sesión activa por usuario** (el nuevo login invalida los anteriores), sería suficiente revocar por `user_id` — pero esa semántica es la que **no** se elegía aquí: el diseño actual permite coexisten sesiones en paralelo (web + móvil) con cierre independiente, que es el caso del transporte multi-frontend que motiva este documento.

---

## 6. Resumen comparativo

| Aspecto | Implementado (hoy) | Recomendado — web SPA | Recomendado — móvil |
|---|---|---|---|
| Access token | `Authorization: Bearer` | `Authorization: Bearer` | `Authorization: Bearer` |
| Almacenamiento del access | Lo decide el cliente | **Memoria JS** (no `localStorage`) | **Keychain/Keystore** |
| Refresh token | **Cookie httpOnly (web) + body — emisión dual** | **Cookie httpOnly + Secure + SameSite=Lax** | **Body** (independiente de la cookie) |
| Almacenamiento del refresh | Web: cookie automática; móvil: el cliente | Cookie (inmune a XSS) | **Keychain/Keystore** |
| CORS | Allowlist, `credentials: true` | `credentials: true` + allowlist estricta | No aplica |
| CSRF | `SameSite=Lax` + `Content-Type: application/json` | `SameSite=Lax` + `Content-Type: application/json` | Sin superficie |
| Sesiones multi-frontend | **`family_id` UUID por sesión** (logout por sesión; reuso revoca solo esa sesión) | **`family_id` UUID por sesión** (logout por dispositivo) | Igual |

**Lectura de la tabla**: las filas "Refresh token", "CORS" y "CSRF" reflejan el transporte dual implementado (web = cookie, móvil = body, sin detección de cliente). La fila "Sesiones multi-frontend" es **independiente** del transporte de tokens: `family_id` por sesión permite logouts independientes en ambos clientes. La revocación global por usuario (`revokeAllForUser`) queda reservada a cambio/reset de password (F1 de US-11/US-12).

---

## 7. Referencias cruzadas

- `docs/00-consideraciones-tecnicas.md` — ítem 38 (patrón access+refresh con rotación y detección de reuso), ítem 39 (transporte dual Bearer+cookie/body, actualizado 11-sep-2026), ítem 42 (logout: revocar el refresh; con access corto no se necesita blocklist), ítem 47 (sesiones y refresh con proveedor mixto), ítem 48 (helmet, CORS con allowlist).
- `docs/04-modelo-de-datos.md` — decisión 2 (`family_id` = UUID de sesión, implementado el 11-sep-2026, FK `family_id → users` eliminada en `0003_cloudy_lucky_pierre.sql`); §5 del presente documento describe la evolución ya aplicada.
- `docs/05-qa-verificacion-arquitectura.md` — §11 (tema tratado: multi-frontend y transporte del token; resolución de la discrepancia del ítem 39).
- `docs/03-openapi.yaml` — contrato fuente: access en header (`Authorization: Bearer`), refresh en cookie `refresh_token` y/o body (`RefreshRequest.refreshToken?`), `security: cookieAuth` en refresh/logout.
- Referencias externas: OWASP Session Management Cheat Sheet (transporte de tokens, cookies httpOnly/SameSite), OWASP XSS Prevention (por qué no `localStorage`), best practices de secure storage iOS (Keychain) / Android (Keystore).