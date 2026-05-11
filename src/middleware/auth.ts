import type { Request, Response, NextFunction } from 'express';
import { createHmac } from 'crypto';
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

function base64urlDecode(s: string): string {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

// Validates a SuiteCRM-issued WS JWT (HS256, signed with WS_JWT_SECRET).
// Accepts the token in Authorization: Bearer <token> header.
export function requireWsJwt(req: Request, res: Response, next: NextFunction): void {
  const secret = config.ws.jwtSecret;
  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const token = auth.slice('Bearer '.length).trim();
  const parts = token.split('.');
  if (parts.length !== 3) {
    res.status(401).json({ error: 'invalid_token' });
    return;
  }

  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
  const expected = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  if (expected !== sigB64) {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    reqLog.warn({ ip: req.ip }, 'invalid WS JWT signature');
    res.status(401).json({ error: 'invalid_token' });
    return;
  }

  let payload: { sub?: string; exp?: number };
  try {
    payload = JSON.parse(base64urlDecode(payloadB64));
  } catch {
    res.status(401).json({ error: 'invalid_token' });
    return;
  }

  if (!payload.exp || Math.floor(Date.now() / 1000) > payload.exp) {
    res.status(401).json({ error: 'token_expired' });
    return;
  }

  next();
}

// Accepts either a bridge API key OR a valid WS JWT.
export function requireBridgeKeyOrWsJwt(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const token = auth.slice('Bearer '.length).trim();

  // If it looks like a JWT (has 2 dots), try WS JWT validation
  if (token.includes('.')) {
    requireWsJwt(req, res, next);
    return;
  }

  // Otherwise fall through to bridge key check
  requireBridgeKey(req, res, next);
}
