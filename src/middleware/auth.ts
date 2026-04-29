import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { logger } from '../logger.js';

export function requireBridgeKey(req: Request, res: Response, next: NextFunction): void {
  const apiKey = config.bridge.apiKey;
  if (apiKey === '') {
    logger.warn('BRIDGE_API_KEY not set — rejecting request');
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const provided = auth.slice('Bearer '.length).trim();
  if (provided !== apiKey) {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    reqLog.warn({ ip: req.ip }, 'invalid bridge API key');
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  next();
}
