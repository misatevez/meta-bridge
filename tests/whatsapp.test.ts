import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

// BRIDGE_API_KEY='test-bridge-key-abc123' is set in tests/setup.ts
const BRIDGE_API_KEY = 'test-bridge-key-abc123';

describe('GET /channels/whatsapp/templates', () => {
  it('returns 401 without bearer token', async () => {
    const app = createApp();
    const res = await request(app).get('/channels/whatsapp/templates');
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong bearer token', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/channels/whatsapp/templates')
      .set('Authorization', 'Bearer wrong-key');
    expect(res.status).toBe(401);
  });

  it('returns mock templates when WABA not configured', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/channels/whatsapp/templates')
      .set('Authorization', `Bearer ${BRIDGE_API_KEY}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ connected: false });
    expect(Array.isArray(res.body.templates)).toBe(true);
    expect(res.body.templates.length).toBeGreaterThan(0);
  });
});

describe('POST /messages/whatsapp', () => {
  it('returns 401 without bearer token', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/messages/whatsapp')
      .send({ to: '+5491112345678', template_name: 'hello_world' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when template_name is missing', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/messages/whatsapp')
      .set('Authorization', `Bearer ${BRIDGE_API_KEY}`)
      .send({ to: '+5491112345678' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'missing_required_fields' });
  });

  it('returns 400 when to is missing', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/messages/whatsapp')
      .set('Authorization', `Bearer ${BRIDGE_API_KEY}`)
      .send({ template_name: 'hello_world' });
    expect(res.status).toBe(400);
  });

  it('returns 202 queued when WABA not configured', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/messages/whatsapp')
      .set('Authorization', `Bearer ${BRIDGE_API_KEY}`)
      .send({ to: '+5491112345678', template_name: 'hello_world', language: 'en_US' });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'queued' });
    expect(typeof res.body.message_id).toBe('string');
  });

  it('returns 202 with variables array', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/messages/whatsapp')
      .set('Authorization', `Bearer ${BRIDGE_API_KEY}`)
      .send({
        to: '+5491112345678',
        template_name: 'bienvenida',
        language: 'es_AR',
        variables: ['Juan', 'Moa CRM'],
        contact_id: 'contact-abc-123',
        account_id: 'account-xyz-456',
      });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'queued' });
  });
});

describe('POST /api/whatsapp/send-template', () => {
  it('returns 401 without bearer token', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/whatsapp/send-template')
      .send({ to: '+5491112345678', template_name: 'hello_world' });
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong bearer token', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/whatsapp/send-template')
      .set('Authorization', 'Bearer wrong-key')
      .send({ to: '+5491112345678', template_name: 'hello_world' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when to is missing', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/whatsapp/send-template')
      .set('Authorization', `Bearer ${BRIDGE_API_KEY}`)
      .send({ template_name: 'hello_world' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: 'missing_required_fields' });
  });

  it('returns 400 when template_name is missing', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/whatsapp/send-template')
      .set('Authorization', `Bearer ${BRIDGE_API_KEY}`)
      .send({ to: '+5491112345678' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: 'missing_required_fields' });
  });

  it('returns 202 queued when WABA not configured (no components)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/whatsapp/send-template')
      .set('Authorization', `Bearer ${BRIDGE_API_KEY}`)
      .send({ to: '+5491112345678', template_name: 'hello_world', language: 'en_US' });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ success: true, status: 'queued' });
    expect(typeof res.body.message_id).toBe('string');
  });

  it('returns 202 queued with components array when WABA not configured', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/whatsapp/send-template')
      .set('Authorization', `Bearer ${BRIDGE_API_KEY}`)
      .send({
        to: '+5491112345678',
        template_name: 'bienvenida',
        language: 'es',
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Juan' }] }],
      });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ success: true, status: 'queued' });
  });

  it('defaults language to es when not provided', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/whatsapp/send-template')
      .set('Authorization', `Bearer ${BRIDGE_API_KEY}`)
      .send({ to: '+5491112345678', template_name: 'hello_world' });

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
  });
});
