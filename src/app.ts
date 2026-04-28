import { randomUUID } from 'node:crypto';
import express, { type Express, type Request, type Response } from 'express';
import pinoHttp from 'pino-http';
import { logger } from './logger.js';
import { registerWebhookRoutes } from './routes/webhook.js';
import type { MessageStore } from './db/wa_messages.js';
import { evaluateHealth, type HealthChecks } from './services/health.js';

const NOOP_STORE: MessageStore = {
  async insertIncomingMessage() {
    return { inserted: true };
  },
};

const NOOP_HEALTH: HealthChecks = {
  async db() {
    return 'ok';
  },
  async suitecrm() {
    return 'ok';
  },
};

export interface AppDeps {
  messageStore?: MessageStore;
  healthChecks?: HealthChecks;
}

export function createApp(deps: AppDeps = {}): Express {
  const app = express();
  const messageStore = deps.messageStore ?? NOOP_STORE;
  const healthChecks = deps.healthChecks ?? NOOP_HEALTH;

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id =
          typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      customProps: (req) => ({ request_id: req.id }),
    }),
  );

  // Webhook routes mount their own raw-body parser scoped to POST /webhook so
  // HMAC can be verified over the unparsed payload. Must be registered before
  // the global express.json() so the JSON parser does not consume the stream.
  registerWebhookRoutes(app, messageStore);

  app.use(express.json({ limit: '1mb' }));

  app.get('/health', async (_req: Request, res: Response) => {
    const result = await evaluateHealth(healthChecks);
    res.status(200).json(result);
  });

  return app;
}
