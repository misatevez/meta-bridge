import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';

const APP_SECRET = 'test-app-secret-cafebabecafebabe';

function sign(body: string): string {
  return crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex');
}

describe('helmet security headers', () => {
  it('sets baseline security headers on every response', async () => {
    const app = createApp();
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    // Helmet removes the default Express x-powered-by leak.
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('rate limiting on /webhook', () => {
  it('returns 429 once the per-IP window cap is exceeded', async () => {
    const app = createApp({
      webhookRateLimitMax: 3,
      webhookRateLimitWindowMs: 60_000,
    });

    const body = '{"object":"page","entry":[]}';
    const sig = sign(body);

    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', `sha256=${sig}`)
        .send(body);
      statuses.push(res.status);
    }

    // First three within the cap should be accepted; later requests are throttled.
    const allowed = statuses.filter((s) => s === 200).length;
    const throttled = statuses.filter((s) => s === 429).length;
    expect(allowed).toBe(3);
    expect(throttled).toBe(2);
  });

  it('does not rate-limit /health', async () => {
    const app = createApp({
      webhookRateLimitMax: 1,
      webhookRateLimitWindowMs: 60_000,
    });

    for (let i = 0; i < 10; i++) {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    }
  });
});
