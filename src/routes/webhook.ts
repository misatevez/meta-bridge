import crypto from 'node:crypto';
import express, { type Express, type Request, type Response } from 'express';
import { config } from '../config.js';

export function webhookGet(req: Request, res: Response): void {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = config.meta.verifyToken;

  if (
    verifyToken !== '' &&
    mode === 'subscribe' &&
    typeof token === 'string' &&
    typeof challenge === 'string' &&
    token === verifyToken
  ) {
    res.status(200).type('text/plain').send(challenge);
    return;
  }

  res.status(403).send('Forbidden');
}

export function webhookPost(req: Request, res: Response): void {
  const header = req.header('X-Hub-Signature-256');
  if (!header || !header.startsWith('sha256=')) {
    res.status(401).send('Unauthorized');
    return;
  }

  const provided = header.slice('sha256='.length);
  const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

  const expectedHex = crypto
    .createHmac('sha256', config.meta.appSecret)
    .update(rawBody)
    .digest('hex');

  const providedBuf = Buffer.from(provided, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  if (
    providedBuf.length === 0 ||
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    res.status(401).send('Unauthorized');
    return;
  }

  let parsed: unknown = null;
  try {
    parsed = rawBody.length > 0 ? JSON.parse(rawBody.toString('utf8')) : null;
  } catch {
    parsed = null;
  }

  console.log('[webhook] event received', parsed);

  res.status(200).send('OK');
}

export function registerWebhookRoutes(app: Express): void {
  app.post('/webhook', express.raw({ type: 'application/json' }), webhookPost);
  app.get('/webhook', webhookGet);
}
