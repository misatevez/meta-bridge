import crypto from 'node:crypto';
import express, { type Express, type Request, type Response } from 'express';
import { config } from '../config.js';
import type { IncomingMessage, MessageStore } from '../db/wa_messages.js';
import { logger } from '../logger.js';
import type { ContactMapper } from '../services/contact-mapper.js';

interface ParsedMessage {
  wamid: string;
  waId: string;
  body: string | null;
  raw: unknown;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

export function parseIncomingMessages(payload: unknown): ParsedMessage[] {
  const root = asObject(payload);
  if (!root) return [];
  const entries = root.entry;
  if (!Array.isArray(entries)) return [];

  const out: ParsedMessage[] = [];
  for (const entry of entries) {
    const e = asObject(entry);
    if (!e) continue;
    const changes = e.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const c = asObject(change);
      if (!c) continue;
      const value = asObject(c.value);
      if (!value) continue;
      const messages = value.messages;
      if (!Array.isArray(messages)) continue;
      for (const m of messages) {
        const msg = asObject(m);
        if (!msg) continue;
        const id = msg.id;
        if (typeof id !== 'string' || id === '') continue;
        const from = msg.from;
        const text = asObject(msg.text);
        const body = text && typeof text.body === 'string' ? text.body : null;
        out.push({
          wamid: id,
          waId: typeof from === 'string' ? from : '',
          body,
          raw: msg,
        });
      }
    }
  }
  return out;
}

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

export function makeWebhookPost(store: MessageStore, contactMapper?: ContactMapper) {
  return async function webhookPost(req: Request, res: Response): Promise<void> {
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

    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const messages = parseIncomingMessages(parsed);

    for (const m of messages) {
      const incoming: IncomingMessage = {
        wamid: m.wamid,
        waId: m.waId,
        body: m.body,
        raw: m.raw,
      };
      try {
        const result = await store.insertIncomingMessage(incoming);
        if (!result.inserted) {
          reqLog.info({ wamid: m.wamid }, 'duplicate webhook, skipping');
        } else {
          reqLog.info({ wamid: m.wamid, wa_id: m.waId }, 'webhook message stored');
          if (contactMapper && m.waId) {
            const contactId = await contactMapper.resolve(m.waId);
            if (contactId !== null) {
              await store.updateContactId(m.wamid, contactId);
              reqLog.info({ wamid: m.wamid, contactId }, 'contact mapped');
            }
          }
        }
      } catch (err) {
        reqLog.error({ err, wamid: m.wamid }, 'failed to persist webhook message');
      }
    }

    res.status(200).send('OK');
  };
}

export function registerWebhookRoutes(app: Express, store: MessageStore, contactMapper?: ContactMapper): void {
  app.post('/webhook', express.raw({ type: 'application/json' }), makeWebhookPost(store, contactMapper));
  app.get('/webhook', webhookGet);
}
