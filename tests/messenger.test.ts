import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

// BRIDGE_API_KEY='test-bridge-key-abc123' is set in tests/setup.ts
const BRIDGE_API_KEY = 'test-bridge-key-abc123';

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.META_PAGE_ACCESS_TOKEN;
});

describe('POST /api/messenger/send', () => {
  it('returns 401 without bearer token', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/messenger/send')
      .send({ psid: '12345', text: 'Hello' });
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong bearer token', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/messenger/send')
      .set('Authorization', 'Bearer wrong-key')
      .send({ psid: '12345', text: 'Hello' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when psid is missing', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/messenger/send')
      .set('Authorization', `Bearer ${BRIDGE_API_KEY}`)
      .send({ text: 'Hello' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'missing_required_fields', required: ['psid', 'text'] });
  });

  it('returns 400 when text is missing', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/messenger/send')
      .set('Authorization', `Bearer ${BRIDGE_API_KEY}`)
      .send({ psid: '12345' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'missing_required_fields' });
  });

  it('returns 400 when psid is empty string', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/messenger/send')
      .set('Authorization', `Bearer ${BRIDGE_API_KEY}`)
      .send({ psid: '   ', text: 'Hello' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when text is empty string', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/messenger/send')
      .set('Authorization', `Bearer ${BRIDGE_API_KEY}`)
      .send({ psid: '12345', text: '' });
    expect(res.status).toBe(400);
  });

  it('calls Graph API and returns message_id when token configured', async () => {
    process.env.META_PAGE_ACCESS_TOKEN = 'test-page-token';

    const axiosMock = await import('axios');
    vi.spyOn(axiosMock.default, 'post').mockResolvedValueOnce({
      status: 200,
      data: { message_id: 'mid.test123', recipient_id: '12345678' },
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/messenger/send')
      .set('Authorization', `Bearer ${BRIDGE_API_KEY}`)
      .send({ psid: '12345678', text: 'Hello from test' });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ success: true, message_id: 'mid.test123' });
  });

  it('returns 502 when Graph API returns error status', async () => {
    process.env.META_PAGE_ACCESS_TOKEN = 'test-page-token';

    const axiosMock = await import('axios');
    vi.spyOn(axiosMock.default, 'post').mockResolvedValueOnce({
      status: 403,
      data: { error: { message: 'Invalid OAuth access token' } },
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/messenger/send')
      .set('Authorization', `Bearer ${BRIDGE_API_KEY}`)
      .send({ psid: '12345678', text: 'Hello' });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ success: false, error: 'graph_api_error' });
  });

  it('returns 502 when Graph API throws network error', async () => {
    process.env.META_PAGE_ACCESS_TOKEN = 'test-page-token';

    const axiosMock = await import('axios');
    vi.spyOn(axiosMock.default, 'post').mockRejectedValueOnce(new Error('Network Error'));

    const app = createApp();
    const res = await request(app)
      .post('/api/messenger/send')
      .set('Authorization', `Bearer ${BRIDGE_API_KEY}`)
      .send({ psid: '12345678', text: 'Hello' });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ success: false, error: 'send_failed' });
  });
});
