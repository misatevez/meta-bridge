import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { Pool } from 'mysql2/promise';

const BRIDGE_KEY = 'test-bridge-key-abc123';
const AUTH = `Bearer ${BRIDGE_KEY}`;

function makePool(rows: unknown[] = []): Pool {
  return { query: vi.fn(() => [rows, []]) } as unknown as Pool;
}

describe('GET /api/conversations/search — input validation', () => {
  it('returns 400 when q exceeds 200 characters', async () => {
    const app = createApp({ firmasCrmPool: makePool() });
    const longQ = 'a'.repeat(201);

    const res = await request(app)
      .get(`/api/conversations/search?q=${longQ}`)
      .set('Authorization', AUTH);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('query_too_long');
  });

  it('accepts q exactly 200 characters', async () => {
    const app = createApp({ firmasCrmPool: makePool([]) });
    const maxQ = 'a'.repeat(200);

    const res = await request(app)
      .get(`/api/conversations/search?q=${maxQ}`)
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.conversations).toBeDefined();
  });

  it('returns 400 for unknown channel value', async () => {
    const app = createApp({ firmasCrmPool: makePool() });

    const res = await request(app)
      .get('/api/conversations/search?channel=telegram')
      .set('Authorization', AUTH);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_channel');
  });

  it.each(['whatsapp', 'facebook', 'instagram'])('accepts channel=%s', async (ch) => {
    const app = createApp({ firmasCrmPool: makePool([]) });

    const res = await request(app)
      .get(`/api/conversations/search?channel=${ch}`)
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
  });

  it('rejects injection attempt with SQL comment sequence', async () => {
    const app = createApp({ firmasCrmPool: makePool([]) });

    const res = await request(app)
      .get("/api/conversations/search?q='; DROP TABLE--")
      .set('Authorization', AUTH);

    // Parameterized queries protect against actual injection;
    // the handler must respond 200 with empty results, not 500.
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.conversations)).toBe(true);
  });

  it('escapes LIKE wildcards in q so % is treated as a literal', async () => {
    const pool = makePool([]);
    const app = createApp({ firmasCrmPool: pool });

    await request(app)
      .get('/api/conversations/search?q=%25')
      .set('Authorization', AUTH);

    const [, capturedParams] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    // The % should be escaped to \% inside the LIKE pattern
    expect(String(capturedParams[0])).toContain('\\%');
  });

  it('escapes LIKE wildcards in q so _ is treated as a literal', async () => {
    const pool = makePool([]);
    const app = createApp({ firmasCrmPool: pool });

    await request(app)
      .get('/api/conversations/search?q=hello_world')
      .set('Authorization', AUTH);

    const [, capturedParams] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    expect(String(capturedParams[0])).toContain('\\_');
  });

  it('returns 401 without auth header', async () => {
    const app = createApp({ firmasCrmPool: makePool() });

    const res = await request(app).get('/api/conversations/search?q=test');
    expect(res.status).toBe(401);
  });

  it('returns 200 with empty results for valid request', async () => {
    const app = createApp({ firmasCrmPool: makePool([]) });

    const res = await request(app)
      .get('/api/conversations/search?q=hello&channel=whatsapp')
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.conversations).toEqual([]);
  });

  it('returns 502 on db error', async () => {
    const pool = { query: vi.fn(() => { throw new Error('db gone'); }) } as unknown as Pool;
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .get('/api/conversations/search?q=test')
      .set('Authorization', AUTH);

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('db_error');
  });
});
