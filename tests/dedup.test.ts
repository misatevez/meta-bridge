import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { IncomingMessage, MessageStore } from '../src/db/wa_messages.js';

const APP_SECRET = 'test-app-secret-cafebabecafebabe';

function sign(body: string): string {
  return crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex');
}

interface FakeStore extends MessageStore {
  rows: Set<string>;
  calls: IncomingMessage[];
}

function makeStore(): FakeStore {
  const rows = new Set<string>();
  const calls: IncomingMessage[] = [];
  return {
    rows,
    calls,
    async insertIncomingMessage(msg) {
      calls.push(msg);
      if (rows.has(msg.wamid)) return { inserted: false };
      rows.add(msg.wamid);
      return { inserted: true };
    },
  };
}

function whatsappWebhookBody(wamid: string, text = 'hola mundo'): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '5491100000000', phone_number_id: 'PNI' },
              contacts: [{ profile: { name: 'Tester' }, wa_id: '5491134567890' }],
              messages: [
                {
                  from: '5491134567890',
                  id: wamid,
                  timestamp: '0',
                  type: 'text',
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

describe('POST /webhook dedup by wamid', () => {
  it('inserts on first delivery and skips on retry', async () => {
    const store = makeStore();
    const app = createApp({ messageStore: store });

    const body = whatsappWebhookBody('wamid.HBgL12345');
    const sig = sign(body);

    const r1 = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', `sha256=${sig}`)
      .send(body);
    expect(r1.status).toBe(200);

    const r2 = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', `sha256=${sig}`)
      .send(body);
    expect(r2.status).toBe(200);

    expect(store.calls).toHaveLength(2);
    expect(store.rows.size).toBe(1);
    expect(store.rows.has('wamid.HBgL12345')).toBe(true);
  });

  it('inserts distinct wamids from different deliveries', async () => {
    const store = makeStore();
    const app = createApp({ messageStore: store });

    for (const wamid of ['wamid.A', 'wamid.B', 'wamid.C']) {
      const body = whatsappWebhookBody(wamid);
      const sig = sign(body);
      const res = await request(app)
        .post('/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', `sha256=${sig}`)
        .send(body);
      expect(res.status).toBe(200);
    }

    expect(store.rows.size).toBe(3);
  });

  it('does not call the store when the body has no messages[]', async () => {
    const store = makeStore();
    const app = createApp({ messageStore: store });

    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const sig = sign(body);

    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', `sha256=${sig}`)
      .send(body);

    expect(res.status).toBe(200);
    expect(store.calls).toHaveLength(0);
  });
});
