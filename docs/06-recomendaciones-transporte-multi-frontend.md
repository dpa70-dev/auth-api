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

**El body es la segunda mejor opción después de la cookie httpOnly** (§3): explícito, no se loguea por defecto por la infraestructura, no hay ambigüedad con el access, y el cliente controla el envío. No obliga a la API a gestionar cookies server-side. Para la app web en producción, la cookie httpOnly sigue siendo superior (§3); para móvil/CLI/scripts, el body es la opción correcta y suficiente.

### 2.3 Ausencia de cookies en la API (CORS sin `credentials`)

La API **no setea ni lee cookies**:

```ts
// index.ts
app.use(cors({ origin: cfg.corsOrigins }));
```

- CORS con **allowlist** (`corsOrigins`) y **sin** `credentials: true`: implica que el navegador no enviará cookies automáticamente en requests cross-origin.
- **Consecuencia de diseño**: el riesgo de XSS (robo de token vía `localStorage`) recae íntegramente en **cómo el cliente web guarda sus tokens**. La API se mantiene agnóstica del almacenamiento del cliente. Esto es una decisión deliberada (ítem 39 de `docs/00`, actualizado el 01-sep-2026).

### 2.4 Resumen de la decisión adoptada

| Elemento | Transporte implementado | Dónde lo guarda el cliente |
|---|---|---|
| Access token | `Authorization: Bearer` | Decisión del cliente (ver §3 y §4) |
| Refresh token | Body de `/auth/refresh` y `/auth/logout` | Decisión del cliente (ver §3 y §4) |
| Cookies | Ninguna | — |
| CORS | Allowlist, sin `credentials: true` | — |

**Conclusión**: lo implementado es **uniforme, simple y correcto** para cualquier cliente. Las secciones siguientes explican cuándo conviene **elevar** ese transporte en clientes concretos.

---

## 3. Recomendación para app web (SPA) — el patrón óptimo

Este es el mensaje central del documento: **para una app web, la mejor práctica es separar el transporte según la vida y el valor del token**, no usar cookie para todo ni Bearer para todo.

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

### 3.3 Qué implicaría en la API si se adopta este patrón (guía, no plan de trabajo)

- `POST /auth/login`, `/auth/google` y `/auth/refresh` deberían emitir `Set-Cookie` con el refresh (además de devolverlo en el body o en su lugar).
- `/auth/refresh` y `/auth/logout` deberían aceptar el refresh **de la cookie (web) o del body (móvil)** — doble fuente de lectura, priorizando la cookie si está presente. El móvil sigue usando body y no se rompe.
- CORS pasaría a `credentials: true` con la **misma allowlist estricta** (nunca `*`; ítem 48 de `docs/00`).
- **CSRF**: la mitigación combinada `SameSite=Lax` + exigir `Content-Type: application/json` (los requests cross-site con body JSON requieren preflight CORS y quedan bloqueados) es suficiente para este contrato. No se necesitaría token CSRF salvo que se relajara alguna de las dos.
- El access **sigue por Bearer**, nunca en cookie.

**Cuándo vale la pena**: solo si hay una SPA web real en producción que controle cómo se guardan los tokens. Para una API de integración/ejemplo, la decisión adoptada (§2) es suficiente.

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

### 5.1 El problema: hoy el logout es global

El modelo de datos actual (decisión 2 de `docs/04`) define:

```
family_id = user_id
```

Es decir, **la "familia" de refresh tokens coincide con el usuario**: todos los refreshes emitidos para un usuario pertenecen a la misma familia. Consecuencias:

- `logout` (revocación de la familia) → revoca **todas** las sesiones del usuario, en **todos** los dispositivos.
- Detección de reuso de un refresh (token ya usado presentado de nuevo) → revoca también **toda** la familia → el usuario queda deslogueado **en todos** los frontends.

Para una fase 1 es **correcto y deliberado** (simple, con una única regla de revocación). Pero si el mismo usuario se autentica desde web **y** móvil (o varios dispositivos) a la vez, "cerrar sesión en el móvil" **también desloguea la web**. Ese comportamiento suele ser indeseable en producción.

### 5.2 La recomendación: un `family_id` por sesión (UUID por login)

Para permitir **logouts independientes por frontend/dispositivo**, el `family_id` debe ser un **identificador de sesión único por login**, no el `user_id`:

```
Cada login (nuevo par access+refresh)  →  se crea una NUEVA familia con su propio family_id (UUID).
La rotación del refresh (refresh → par nuevo)  →  mantiene el MISMO family_id (padre → hijo).
```

- **Login en web** → familia A (web).
- **Login en móvil** → familia B (móvil).
- La rotación en web mantiene A; la rotación en móvil mantiene B.
- `logout` presentando el refresh de la familia A → **revoca solo A**. El usuario sigue logueado en el móvil (familia B).
- Reuso detectado en A → revoca solo A. B queda intacta.

**Regla de oro**: la revocación se ejecuta por `family_id`, y el `family_id` identifica **una sesión/dispositivo**, no a la persona.

### 5.3 Cambios que requeriría el modelo (guía de evolución)

1. **Emisión**: `insertRefreshToken` recibe `familyId = crypto.randomUUID()` en el login (en vez de `user_id`).
2. **Puerto/implementación**: `revokeFamily` pasa a recibir `familyId` (no `userId`); el repositorio ya resuelve la familia del token presentado por su hash → revoca solo esa fila/familia.
3. **Contrato/API**: decidir si `logout` admite dos semánticas — `logout` (revoca la sesión/familia del token presentado) vs `logoutAll` (revoca todas las familias del `userId`). Hoy solo existe la primera y, por `family_id = user_id`, equivale a la segunda.
4. **Migración**: trivial si se hace — las sesiones existentes con `family_id = user_id` se tratan como familias preexistentes de un solo uso; los logins nuevos ya generan su UUID.
5. **Trazabilidad**: opcionalmente, registrar en `refresh_tokens` un campo `client`/`device` (o reutilizar el ítem 47 de `docs/00`: proveedor `local|google`) para que el usuario pueda listar y revocar sesiones específicas desde la UI.

### 5.4 Cuándo NO hace falta este cambio

Si el producto deliberadamente quiere **una sola sesión activa por usuario** (el nuevo login invalida los anteriores, re-login al cambiar de dispositivo), entonces **la decisión actual es la correcta y la más simple** — y `family_id = user_id` es precisamente lo que la garantiza. La recomendación aplica solo cuando coexisten sesiones en paralelo (web + móvil) con cierre independiente.

---

## 6. Resumen comparativo

| Aspecto | Implementado (hoy) | Recomendado — web SPA | Recomendado — móvil |
|---|---|---|---|
| Access token | `Authorization: Bearer` | `Authorization: Bearer` | `Authorization: Bearer` |
| Almacenamiento del access | Lo decide el cliente | **Memoria JS** (no `localStorage`) | **Keychain/Keystore** |
| Refresh token | **Body** de `/auth/refresh` y `/auth/logout` | **Cookie httpOnly + Secure + SameSite=Lax** | **Body** (igual que hoy) |
| Almacenamiento del refresh | Lo decide el cliente | Cookie (inmune a XSS) | **Keychain/Keystore** |
| CORS | Allowlist, sin `credentials` | `credentials: true` + allowlist estricta | No aplica |
| CSRF | Sin superficie (sin cookies) | `SameSite=Lax` + `Content-Type: application/json` | Sin superficie |
| Sesiones multi-frontend | `family_id = user_id` (logout global) | **Recomendado: `family_id` UUID por sesión** (logout por dispositivo) | Igual |

**Lectura de la tabla**: la fila "Sesiones multi-frontend" es **independiente** del transporte de tokens: aplicar o no el patrón cookie (web) no cambia la necesidad de `family_id` por sesión si se quieren logouts independientes.

---

## 7. Referencias cruzadas

- `docs/00-consideraciones-tecnicas.md` — ítem 38 (patrón access+refresh con rotación y detección de reuso), ítem 39 (transporte Bearer-only, actualizado 01-sep-2026), ítem 42 (logout: revocar el refresh; con access corto no se necesita blocklist), ítem 47 (sesiones y refresh con proveedor mixto), ítem 48 (helmet, CORS con allowlist).
- `docs/04-modelo-de-datos.md` — decisión 2 (`family_id = user_id` en esta iteración); §5 del presente documento describe la evolución recomendada.
- `docs/05-qa-verificacion-arquitectura.md` — §11 (tema tratado: multi-frontend y transporte del token; resolución de la discrepancia del ítem 39).
- `docs/03-openapi.yaml` — contrato fuente: define dónde viajan access (header) y refresh (body) hoy.
- Referencias externas: OWASP Session Management Cheat Sheet (transporte de tokens, cookies httpOnly/SameSite), OWASP XSS Prevention (por qué no `localStorage`), best practices de secure storage iOS (Keychain) / Android (Keystore).