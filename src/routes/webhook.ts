import crypto from 'node:crypto';
import express, { type Express, type Request, type Response } from 'express';
import { config } from '../config.js';
import type { IncomingMessage, MessageStore } from '../db/wa_messages.js';
import { logger } from '../logger.js';
import type { SuiteCrmSyncService } from '../services/suitecrm-sync.js';

interface ParsedMessage {
  wamid: string;
  waId: string;
  body: string | null;
  raw: unknown;
  timestamp: number;
  messageType: string;
  profileName: string;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function extractProfileName(value: Record<string, unknown>, waId: string): string {
  const contacts = value.contacts;
  if (!Array.isArray(contacts)) return waId;
  for (const c of contacts) {
    const contact = asObject(c);
    if (!contact) continue;
    if (contact.wa_id !== waId) continue;
    const profile = asObject(contact.profile);
    if (profile && typeof profile.name === 'string' && profile.name.length > 0) {
      return profile.name;
    }
  }
  return waId;
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
        const waId = typeof from === 'string' ? from : '';
        const text = asObject(msg.text);
        const body = text && typeof text.body === 'string' ? text.body : null;
        const rawTs = msg.timestamp;
        const timestamp = typeof rawTs === 'string' ? Number.parseInt(rawTs, 10) : typeof rawTs === 'number' ? rawTs : Math.floor(Date.now() / 1000);
        const messageType = typeof msg.type === 'string' ? msg.type : 'text';
        const profileName = extractProfileName(value, waId);
        out.push({
          wamid: id,
          waId,
          body,
          raw: msg,
          timestamp,
          messageType,
          profileName,
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

export function makeWebhookPost(store: MessageStore, syncService?: SuiteCrmSyncService) {
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
      let inserted = false;
      try {
        const result = await store.insertIncomingMessage(incoming);
        inserted = result.inserted;
        if (!inserted) {
          reqLog.info({ wamid: m.wamid }, 'duplicate webhook, skipping');
        } else {
          reqLog.info({ wamid: m.wamid, wa_id: m.waId }, 'webhook message stored');
        }
      } catch (err) {
        reqLog.error({ err, wamid: m.wamid }, 'failed to persist webhook message');
      }

      if (inserted && syncService) {
        void syncService.syncMessage({
          waId: m.waId,
          wamid: m.wamid,
          body: m.body,
          timestamp: m.timestamp,
          messageType: m.messageType,
          direction: 'in',
          profileName: m.profileName,
          contactIdSuitecrm: null,
          phoneNumberId: config.waba.phoneNumberId,
        });
      }
    }

    res.status(200).send('OK');
  };
}

export function registerWebhookRoutes(app: Express, store: MessageStore, syncService?: SuiteCrmSyncService): void {
  app.post('/webhook', express.raw({ type: 'application/json' }), makeWebhookPost(store, syncService));
  app.get('/webhook', webhookGet);
}
