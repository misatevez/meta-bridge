import express, { type Express, type Request, type Response } from 'express';
import pinoHttp from 'pino-http';
import { logger } from './logger.js';

export function createApp(): Express {
  const app = express();

  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
    });
  });

  return app;
}
