# meta-bridge

Bridge **Meta** (WhatsApp Cloud API / Instagram / Facebook) ↔ **SuiteCRM `firmas`**.

Servicio Node 22 + Express + TypeScript. Aísla rate limits, refresh de tokens y verificación HMAC fuera del CRM. El App Secret nunca toca el código de SuiteCRM.

> Sprint 2 — Fase A. Este repo es el esqueleto del bridge. Las piezas reales (verify token, suscripción de webhook fields, cliente OAuth2 contra API V8, schema DB) se irán poblando en B2–B6.

## Stack

- Node 22
- Express 4
- TypeScript 5 (strict)
- pino + pino-http (logs)
- vitest + supertest (tests)
- tsx (dev runner)
- pm2 (proceso en server)

## Estructura

```
meta-bridge/
├── README.md
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .env.example
├── .gitignore
├── src/
│   ├── server.ts        Bootstrap + signal handlers
│   ├── app.ts           Express app factory + GET /health
│   ├── config.ts        Lee .env y tipa todo
│   ├── logger.ts        pino instance
│   ├── routes/
│   │   └── webhook.ts   GET (verify) + POST (HMAC) handlers
│   ├── services/
│   │   └── suitecrm.ts  Cliente OAuth2 API V8 + helpers Contact/Lead/Note
│   └── db/              (vacía — runtime queries en B5+)
├── db/
│   ├── migrate.ts       Runner idempotente (mysql2 + _migrations)
│   └── migrations/
│       └── 001-initial.sql
└── tests/
    ├── setup.ts         Env stubs para vitest
    ├── smoke.test.ts    GET /health → 200
    ├── webhook.test.ts  GET verify + POST HMAC
    └── suitecrm.test.ts SuiteCrmClient (token + helpers + 401 retry)
```

## Webhook (Meta)

El bridge expone `https://meta-bridge.moacrm.com/webhook` para recibir eventos de WhatsApp Cloud API / Instagram / Facebook Pages.

- **`GET /webhook`** — handshake de verificación. Meta envía `hub.mode=subscribe`, `hub.verify_token` y `hub.challenge`. Si el verify token matchea `META_VERIFY_TOKEN`, respondemos `hub.challenge` como `text/plain` 200. Caso contrario 403.
- **`POST /webhook`** — entrega de eventos. Validamos `X-Hub-Signature-256` haciendo `HMAC-SHA256(rawBody, META_APP_SECRET)` y comparando en tiempo constante (`crypto.timingSafeEqual`). Si la firma valida, 200. Si no, 401.

### Generar el verify token

```bash
openssl rand -hex 32
```

Copialo a `META_VERIFY_TOKEN` en `.env` y configurá el mismo valor en la Meta App (Webhooks → Verify Token) cuando llegue Fase B.

## SuiteCRM API V8 client

`src/services/suitecrm.ts` expone `SuiteCrmClient(baseUrl, clientId, clientSecret)`:

- `getAccessToken()` — POST `/legacy/Api/access_token` (`grant_type=client_credentials`). Cachea el JWT en memoria con `expires_at`; refresca automáticamente cuando faltan menos de 60s.
- `request(method, path, body?)` — agrega `Authorization: Bearer <token>` y `Accept: application/vnd.api+json`. Si el server responde 401, invalida el cache, pide token nuevo y reintenta una vez.
- `findContactByPhone(e164)` — busca en `Contacts` por `phone_mobile` (sin `+`, formato wa_id). Devuelve `null` si no existe.
- `createLead({ firstName, lastName, phoneE164, source })` — POST a `/legacy/Api/V8/module` con `data.type = "Leads"`.
- `appendNote(parentType, parentId, body)` — crea Note con `parent_type` + `parent_id` apuntando al Contact o Lead.

Errores 4xx/5xx se propagan como `SuiteCrmApiError(status, body)`.

### Smoke test manual contra `firmas`

No va al repo (usa credenciales reales del Architect):

```bash
# Cargar SUITECRM_OAUTH_CLIENT_ID + SUITECRM_OAUTH_CLIENT_SECRET en el shell desde el vault
node --input-type=module -e "
import { SuiteCrmClient } from './dist/services/suitecrm.js';
const c = new SuiteCrmClient(
  'https://firmas.moacrm.com',
  process.env.SUITECRM_OAUTH_CLIENT_ID,
  process.env.SUITECRM_OAUTH_CLIENT_SECRET,
);
console.log(await c.findContactByPhone('+5491100000000'));
"
```

## Setup local

```bash
cp .env.example .env
# editar .env con valores reales (App Secret en custodia del Architect, no commitear)
npm install
npm run dev
```

El server queda escuchando en `:3000` (configurable vía `PORT`).

```bash
curl http://localhost:3000/health
# { "status": "ok", "uptime": 12.345 }
```

## Tests

```bash
npm test
```

## Observability

### Logging

`src/logger.ts` exporta una instancia única de `pino`.

- **Producción** (`NODE_ENV=production`) — JSON line-delimited a `stdout`. Parseable con `jq`, `lnav`, Loki/Grafana, etc.
  ```bash
  pm2 logs meta-bridge --raw | jq 'select(.level >= 40)'   # solo warn+
  pm2 logs meta-bridge --raw | jq -r '.request_id + " " + (.msg // "")'
  ```
- **Desarrollo** (`NODE_ENV=development`) — formato amigable (colores + timestamp legible) vía `pino-pretty`. No requiere flag adicional, lo activa el logger cuando detecta `NODE_ENV=development`.
- **Tests** (`NODE_ENV=test`) — `LOG_LEVEL=silent` por default (ver `tests/setup.ts`).

Niveles: `info`, `warn`, `error`, `fatal`. El nivel mínimo por default es `info`, configurable vía `LOG_LEVEL`.

Cada request HTTP recibe un `request_id` (UUID v4, o el valor del header `X-Request-Id` entrante si viene) que `pino-http` propaga en cada log line del request y se devuelve en el header `X-Request-Id` de la respuesta. Permite correlacionar logs con clientes externos (Meta, SuiteCRM) que repropagan el header.

```bash
# Tail JSON en producción
pm2 logs meta-bridge --raw

# Tail JSON con resaltado en dev
npm run dev
```

### Healthcheck

`GET /health` evalúa cada dependencia y devuelve un body JSON con el estado consolidado.

```json
{
  "status": "ok",
  "checks": { "db": "ok", "suitecrm": "ok" },
  "uptime": 142.31,
  "version": "0.1.0"
}
```

Reglas:

- `status` es `ok` si **todos** los checks pasan; `degraded` si alguno falla pero el proceso sigue arriba.
- El endpoint **siempre** responde HTTP 200 — la decisión de marcar al servicio como caído queda fuera (PM2 / monitoring externo). Esto evita que un blip transitorio en la DB tire al server de detrás del LB.
- `version` se lee de `package.json` al boot.

Checks actuales:

| Check | Verifica |
|---|---|
| `db` | `SELECT 1` contra el pool MySQL (`meta_bridge` en MariaDB OCI). |
| `suitecrm` | `getAccessToken()` del `SuiteCrmClient` — devuelve cache si está vigente, refresca contra `/legacy/Api/access_token` si expiró. |

```bash
curl -s https://meta-bridge.moacrm.com/health | jq .
curl -s http://localhost:3000/health | jq .
```

### Deduplicación de webhooks

Meta reentrega un webhook si el bridge no responde 200 en menos de ~5s. Cada `messages[i]` que llega al `POST /webhook` se inserta en `wa_messages` con `INSERT IGNORE` apoyado en `UNIQUE (wamid)`:

- Si la fila era nueva → se procesa (`webhook message stored`).
- Si ya existía → se loguea `duplicate webhook, skipping` y se descarta silenciosamente.

El bridge **siempre** responde 200 a la entrega (incluso a duplicadas) para que Meta no reintente.

### Errores no capturados

`src/server.ts` engancha `uncaughtException` y `unhandledRejection`: loguea como `fatal` y deja al supervisor (PM2) relevantar el proceso. Al ejecutar bajo `pm2 start dist/server.js --name meta-bridge`, los reinicios se ven con `pm2 status`.

## Build + producción local

```bash
npm run build
npm start
```

## Deploy en server (`132.145.128.135`)

Subdominio: `meta-bridge.moacrm.com` (reverse proxy Apache → `127.0.0.1:3000`).

```bash
# en el server
git clone https://github.com/misatevez/meta-bridge.git /opt/meta-bridge
cd /opt/meta-bridge
cp .env.example .env
# editar .env con secrets reales
npm ci --omit=dev
npm run build
pm2 start dist/server.js --name meta-bridge
pm2 save
```

`pm2 logs meta-bridge` para ver tail de logs (pino los emite a stdout).

## Database

DB nueva en MariaDB OCI managed (`129.213.101.91:3306`), aislada de `firmascrm`. El user `meta_bridge` solo tiene permisos sobre la base `meta_bridge` (`SHOW GRANTS FOR 'meta_bridge'@'%';`).

### Schema

| Tabla | Rol |
|---|---|
| `wa_messages` | Log de mensajes WhatsApp (in/out). PK `id`, UNIQUE `wamid` (deduplicación de webhooks Meta), índices por `wa_id` y `created_at`. |
| `bridge_oauth_tokens` | Cache opcional del access token OAuth2 contra SuiteCRM API V8. Una sola fila (PK `id` = 1). |
| `wa_contacts_map` | Cache `wa_id` → `contact_id_suitecrm` para evitar buscar Contact por phone en cada mensaje. |
| `_migrations` | Registro de migrations aplicadas (mantenido por `db/migrate.ts`). |

ER diagram completo: ver `docs/sprint2/B4-meta-bridge-schema.md` en el repo `misatevez/suitecrm`.

### Migrations

Las migrations viven en `db/migrations/NNN-name.sql` (3 dígitos, orden léxico). El runner `db/migrate.ts`:

1. Crea la tabla `_migrations` si no existe.
2. Lee qué versiones ya se aplicaron.
3. Ejecuta solo las pendientes, en orden, registrando cada una al cerrar.

Es idempotente — reaplicar es no-op.

```bash
# Asegurate de tener .env con DB_HOST/PORT/USER/PASS/NAME apuntando a meta_bridge.
npm install
npm run db:migrate
```

Output esperado en una corrida limpia:

```
INFO applying { version: '001', name: '001-initial' }
INFO migrations complete { ran: 1, total: 1 }
```

En la segunda corrida:

```
INFO skip — already applied { version: '001', name: '001-initial' }
INFO migrations complete { ran: 0, total: 1 }
```

### Conexión local (administrativa)

Para inspeccionar la DB desde el server (que sí tiene cliente `mysql` y red privada hacia OCI):

```bash
ssh ubuntu@132.145.128.135
mysql -h 129.213.101.91 -u meta_bridge -p meta_bridge
# password: (custodia del Architect)
SHOW TABLES;
SELECT * FROM _migrations;
```

Aplicar manualmente la migration sin pasar por el runner Node:

```bash
mysql -h 129.213.101.91 -u meta_bridge -p meta_bridge < db/migrations/001-initial.sql
```

### Bootstrap inicial (una sola vez, root)

La creación de la DB y el user `meta_bridge` está documentada en `docs/sprint2/B4-meta-bridge-schema.md` del repo `suitecrm`. Resumen:

```sql
CREATE DATABASE meta_bridge CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'meta_bridge'@'%' IDENTIFIED BY '<password>';
GRANT ALL PRIVILEGES ON meta_bridge.* TO 'meta_bridge'@'%';
FLUSH PRIVILEGES;
```

`meta_bridge` **no** tiene grants sobre `firmascrm` ni ninguna otra base. Validable con:

```sql
SHOW GRANTS FOR 'meta_bridge'@'%';
-- GRANT USAGE ON *.* TO `meta_bridge`@`%`
-- GRANT ALL PRIVILEGES ON `meta_bridge`.* TO `meta_bridge`@`%`
```

## Variables de entorno

Ver `.env.example`. Resumen:

| Variable | Origen |
|---|---|
| `META_APP_ID` | App de Meta entregada por el cliente |
| `META_APP_SECRET` | Custodia del Architect (no commit) |
| `META_VERIFY_TOKEN` | Generado en B2, guardado en config Meta App |
| `SUITECRM_BASE_URL` | `https://firmas.moacrm.com` |
| `SUITECRM_OAUTH_CLIENT_ID` / `_SECRET` | Cliente OAuth2 creado en Sprint 2 A2 |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASS` / `DB_NAME` | MariaDB OCI managed, base `meta_bridge` |
| `PORT` | 3000 |

## Arquitectura

Ver el research previo en el repo `misatevez/suitecrm`:

- [`docs/08-meta-research.md`](https://github.com/misatevez/suitecrm/blob/main/docs/08-meta-research.md) — research inicial Meta (INF-953).

Resumen de la decisión: bridge externo en el mismo VM (`132.145.128.135`) bajo el subdominio `meta-bridge.moacrm.com`. Apache reverse-proxy hacia `127.0.0.1:3000`. Webhooks de Meta llegan al bridge, el bridge verifica HMAC con `META_APP_SECRET`, normaliza el evento y lo empuja a SuiteCRM API V8 vía OAuth2 client credentials.

## Issues relacionadas

Sprint 2 Fase A:

- B1 — Bootstrap repo.
- B2 — Webhook (verify GET + HMAC POST).
- B3 — Cliente OAuth2 SuiteCRM API V8 + helpers Contact/Lead/Note (este).
- B4 — Schema DB (`meta_bridge`).
- B5 — Logging JSON + healthcheck + dedup.
- B6 — Tests E2E + auditoría de seguridad + CI.

Cuando el cliente conecte canales reales (WABA / Page / IG Business) → Sprint 2 Fase B suscribe los webhook fields y carga Phone Number ID, WABA ID y Permanent Token.

## Constraints

- **Nunca** commitear `META_APP_SECRET`, `SUITECRM_OAUTH_CLIENT_SECRET`, ni credenciales de DB. `.env` está en `.gitignore`.
- `.env.example` solo lleva placeholders.
