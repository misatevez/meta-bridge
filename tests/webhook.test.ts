import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';

const VERIFY_TOKEN = 'test-verify-token-deadbeefdeadbeef';
const APP_SECRET = 'test-app-secret-cafebabecafebabe';

function sign(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

describe('GET /webhook (verify)', () => {
  it('returns the challenge as text/plain when the verify token matches', async () => {
    const app = createApp();
    const res = await request(app).get('/webhook').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': VERIFY_TOKEN,
      'hub.challenge': 'challenge-12345',
    });

    expect(res.status).toBe(200);
    expect(res.text).toBe('challenge-12345');
    expect(res.headers['content-type']).toMatch(/text\/plain/);
  });

  it('returns 403 when the verify token does not match', async () => {
    const app = createApp();
    const res = await request(app).get('/webhook').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong-token',
      'hub.challenge': 'challenge-12345',
    });

    expect(res.status).toBe(403);
  });
});

describe('POST /webhook (HMAC)', () => {
  it('returns 200 when the signature is valid', async () => {
    const app = createApp();
    const body = '{"object":"page","entry":[{"id":"123","time":0,"messaging":[]}]}';
    const sig = sign(body, APP_SECRET);

    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', `sha256=${sig}`)
      .send(body);

    expect(res.status).toBe(200);
  });

  it('returns 401 when the signature is invalid', async () => {
    const app = createApp();
    const body = '{"object":"page","entry":[]}';
    const wrongSig = sign(body, 'a-different-secret');

    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', `sha256=${wrongSig}`)
      .send(body);

    expect(res.status).toBe(401);
  });

  it('returns 401 when the X-Hub-Signature-256 header is missing', async () => {
    const app = createApp();
    const body = '{"object":"page","entry":[]}';

    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(res.status).toBe(401);
  });

  it('returns 401 when the body has been altered after signing', async () => {
    const app = createApp();
    const original = '{"object":"page","entry":[{"id":"123","time":0,"messaging":[]}]}';
    const altered = '{"object":"page","entry":[{"id":"999","time":0,"messaging":[]}]}';
    const sig = sign(original, APP_SECRET);

    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', `sha256=${sig}`)
      .send(altered);

    expect(res.status).toBe(401);
  });

  it('returns 401 when the signature header has the wrong prefix', async () => {
    const app = createApp();
    const body = '{"object":"page","entry":[]}';
    const sig = sign(body, APP_SECRET);

    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', `sha1=${sig}`)
      .send(body);

    expect(res.status).toBe(401);
  });
});
