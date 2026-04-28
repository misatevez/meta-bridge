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
│   ├── routes/          (vacía — B2: webhook GET/POST)
│   ├── services/        (vacía — B3: firma HMAC, B4: OAuth2 SuiteCRM)
│   └── db/              (vacía — B5: schema MariaDB)
└── tests/
    └── smoke.test.ts    GET /health → 200
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

- B1 — Bootstrap repo (este).
- B2 — Endpoint webhook (verify GET + receive POST).
- B3 — Verificación de firma HMAC.
- B4 — Cliente OAuth2 contra SuiteCRM API V8.
- B5 — Schema DB (`meta_bridge`).
- B6 — Tests + deploy + smoke E2E.

Cuando el cliente conecte canales reales (WABA / Page / IG Business) → Sprint 2 Fase B suscribe los webhook fields y carga Phone Number ID, WABA ID y Permanent Token.

## Constraints

- **Nunca** commitear `META_APP_SECRET`, `SUITECRM_OAUTH_CLIENT_SECRET`, ni credenciales de DB. `.env` está en `.gitignore`.
- `.env.example` solo lleva placeholders.
