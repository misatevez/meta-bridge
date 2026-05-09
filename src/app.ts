import { randomUUID } from 'node:crypto';
import express, { type Express, type Request, type Response } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { logger } from './logger.js';
import { registerWebhookRoutes } from './routes/webhook.js';
import { registerWhatsAppRoutes } from './routes/whatsapp.js';
import { registerMessengerRoutes } from './routes/messenger.js';
import { registerInstagramRoutes } from './routes/instagram.js';
import type { MessageStore } from './db/wa_messages.js';
import { evaluateHealth, type HealthChecks } from './services/health.js';
import type { SuiteCrmSyncService } from './services/suitecrm-sync.js';
import type { ContactMapper } from './services/contact-mapper.js';

const NOOP_STORE: MessageStore = {
  async insertIncomingMessage() {
    return { inserted: true };
  },
  async updateContactId() {
    // no-op in tests
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
  suiteCrmSync?: SuiteCrmSyncService;
  contactMapper?: ContactMapper;
  webhookRateLimitMax?: number;
  webhookRateLimitWindowMs?: number;
}

const DEFAULT_WEBHOOK_RATE_LIMIT_MAX = 100;
const DEFAULT_WEBHOOK_RATE_LIMIT_WINDOW_MS = 60_000;

export function createApp(deps: AppDeps = {}): Express {
  const app = express();
  const messageStore = deps.messageStore ?? NOOP_STORE;
  const healthChecks = deps.healthChecks ?? NOOP_HEALTH;
  const suiteCrmSync = deps.suiteCrmSync;
  const { contactMapper } = deps;
  const rateLimitMax = deps.webhookRateLimitMax ?? DEFAULT_WEBHOOK_RATE_LIMIT_MAX;
  const rateLimitWindow = deps.webhookRateLimitWindowMs ?? DEFAULT_WEBHOOK_RATE_LIMIT_WINDOW_MS;

  // Trust proxy: production runs behind Apache reverse proxy, so honor the
  // first hop's X-Forwarded-For for per-IP rate limiting.
  app.set('trust proxy', 1);

  app.use(helmet());

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

  const webhookLimiter = rateLimit({
    windowMs: rateLimitWindow,
    limit: rateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'rate_limited' },
  });
  app.use('/webhook', webhookLimiter);

  // Webhook routes mount their own raw-body parser scoped to POST /webhook so
  // HMAC can be verified over the unparsed payload. Must be registered before
  // the global express.json() so the JSON parser does not consume the stream.
  registerWebhookRoutes(app, messageStore, contactMapper, suiteCrmSync);

  app.use(express.json({ limit: '1mb' }));

  registerWhatsAppRoutes(app);
  registerMessengerRoutes(app);
  registerInstagramRoutes(app);

  app.get('/health', async (_req: Request, res: Response) => {
    const result = await evaluateHealth(healthChecks);
    res.status(200).json(result);
  });

  return app;
}
