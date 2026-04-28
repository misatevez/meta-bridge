import express, { type Express, type Request, type Response } from 'express';
import pinoHttp from 'pino-http';
import { logger } from './logger.js';
import { registerWebhookRoutes } from './routes/webhook.js';

export function createApp(): Express {
  const app = express();

  app.use(pinoHttp({ logger }));

  // Webhook routes mount their own raw-body parser scoped to POST /webhook so
  // HMAC can be verified over the unparsed payload. Must be registered before
  // the global express.json() so the JSON parser does not consume the stream.
  registerWebhookRoutes(app);

  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
    });
  });

  return app;
}
