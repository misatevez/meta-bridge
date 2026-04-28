import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('GET /health (enriched)', () => {
  it('returns ok when both checks pass', async () => {
    const app = createApp({
      healthChecks: {
        async db() {
          return 'ok';
        },
        async suitecrm() {
          return 'ok';
        },
      },
    });

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks).toEqual({ db: 'ok', suitecrm: 'ok' });
    expect(typeof res.body.uptime).toBe('number');
    expect(typeof res.body.version).toBe('string');
    expect(res.body.version.length).toBeGreaterThan(0);
  });

  it('returns degraded when the db check fails', async () => {
    const app = createApp({
      healthChecks: {
        async db() {
          return 'fail';
        },
        async suitecrm() {
          return 'ok';
        },
      },
    });

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks).toEqual({ db: 'fail', suitecrm: 'ok' });
  });

  it('returns degraded when a check throws', async () => {
    const app = createApp({
      healthChecks: {
        async db() {
          throw new Error('connection refused');
        },
        async suitecrm() {
          return 'ok';
        },
      },
    });

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.db).toBe('fail');
  });
});

describe('request_id propagation', () => {
  it('echoes back x-request-id when provided', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/health')
      .set('x-request-id', 'incoming-test-id-123');

    expect(res.headers['x-request-id']).toBe('incoming-test-id-123');
  });

  it('generates an x-request-id when none is provided', async () => {
    const app = createApp();
    const res = await request(app).get('/health');
    expect(typeof res.headers['x-request-id']).toBe('string');
    expect((res.headers['x-request-id'] as string).length).toBeGreaterThan(0);
  });
});
