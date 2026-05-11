import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { Pool } from 'mysql2/promise';

const BRIDGE_KEY = 'test-bridge-key-abc123';
const AUTH = `Bearer ${BRIDGE_KEY}`;

function makePool(queryFn: (...args: unknown[]) => unknown): Pool {
  return { query: vi.fn(queryFn) } as unknown as Pool;
}

function makeSequentialPool(responses: unknown[]): Pool {
  let call = 0;
  return { query: vi.fn(() => responses[call++] ?? [{ affectedRows: 0 }, []]) } as unknown as Pool;
}

const CANNED_1 = {
  id: 1,
  title: 'Greeting',
  content: 'Hello, how can I help you?',
  channel: 'all',
  shortcut: '/hello',
  created_by: 'user-1',
  created_at: new Date('2026-05-01'),
  updated_at: new Date('2026-05-01'),
};

const CANNED_2 = {
  id: 2,
  title: 'WA Farewell',
  content: 'Goodbye!',
  channel: 'whatsapp',
  shortcut: null,
  created_by: 'user-2',
  created_at: new Date('2026-05-02'),
  updated_at: new Date('2026-05-02'),
};

// ── GET /api/canned-responses ─────────────────────────────────────────────────

describe('GET /api/canned-responses', () => {
  it('returns all canned responses', async () => {
    const pool = makePool(() => [[CANNED_1, CANNED_2], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .get('/api/canned-responses')
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].title).toBe('Greeting');
  });

  it('returns empty list when no responses exist', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .get('/api/canned-responses')
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('filters by channel', async () => {
    const pool = makePool(() => [[CANNED_2], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .get('/api/canned-responses?channel=whatsapp')
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data[0].channel).toBe('whatsapp');

    // Confirm the SQL query included the channel param
    const [sql] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string[]];
    expect(sql).toContain('channel');
  });

  it('filters by created_by', async () => {
    const pool = makePool(() => [[CANNED_1], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .get('/api/canned-responses?created_by=user-1')
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);

    const [sql, params] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string[]];
    expect(sql).toContain('created_by');
    expect(params).toContain('user-1');
  });

  it('returns 401 without auth', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app).get('/api/canned-responses');
    expect(res.status).toBe(401);
  });

  it('returns 502 on db error', async () => {
    const pool = makePool(() => { throw new Error('db gone'); });
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .get('/api/canned-responses')
      .set('Authorization', AUTH);

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('db_error');
  });
});

// ── POST /api/canned-responses ────────────────────────────────────────────────

describe('POST /api/canned-responses', () => {
  it('creates a canned response and returns it', async () => {
    const pool = makeSequentialPool([
      [{ insertId: 3, affectedRows: 1 }, []],
      [[{ ...CANNED_1, id: 3 }], []],
    ]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .post('/api/canned-responses')
      .set('Authorization', AUTH)
      .send({ title: 'Greeting', content: 'Hello!', channel: 'all', created_by: 'user-1' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(3);
  });

  it('defaults channel to "all" when not provided', async () => {
    const pool = makeSequentialPool([
      [{ insertId: 4, affectedRows: 1 }, []],
      [[{ ...CANNED_1, id: 4, channel: 'all' }], []],
    ]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .post('/api/canned-responses')
      .set('Authorization', AUTH)
      .send({ title: 'Test', content: 'Test content' });

    expect(res.status).toBe(201);

    const [, params] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    expect(params).toContain('all');
  });

  it('stores created_by when provided', async () => {
    const pool = makeSequentialPool([
      [{ insertId: 5, affectedRows: 1 }, []],
      [[CANNED_1], []],
    ]);
    const app = createApp({ firmasCrmPool: pool });

    await request(app)
      .post('/api/canned-responses')
      .set('Authorization', AUTH)
      .send({ title: 'T', content: 'C', created_by: 'agent-99' });

    const [, params] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    expect(params).toContain('agent-99');
  });

  it('returns 400 when title is missing', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .post('/api/canned-responses')
      .set('Authorization', AUTH)
      .send({ content: 'No title' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when content is missing', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .post('/api/canned-responses')
      .set('Authorization', AUTH)
      .send({ title: 'No content' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid channel', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .post('/api/canned-responses')
      .set('Authorization', AUTH)
      .send({ title: 'T', content: 'C', channel: 'telegram' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('invalid channel');
  });

  it('accepts all valid channels', async () => {
    for (const ch of ['whatsapp', 'messenger', 'instagram', 'all']) {
      const pool = makeSequentialPool([
        [{ insertId: 10, affectedRows: 1 }, []],
        [[{ ...CANNED_1, id: 10, channel: ch }], []],
      ]);
      const app = createApp({ firmasCrmPool: pool });

      const res = await request(app)
        .post('/api/canned-responses')
        .set('Authorization', AUTH)
        .send({ title: 'T', content: 'C', channel: ch });

      expect(res.status).toBe(201);
    }
  });

  it('returns 401 without auth', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .post('/api/canned-responses')
      .send({ title: 'T', content: 'C' });

    expect(res.status).toBe(401);
  });

  it('returns 502 on db error', async () => {
    const pool = makePool(() => { throw new Error('db gone'); });
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .post('/api/canned-responses')
      .set('Authorization', AUTH)
      .send({ title: 'T', content: 'C' });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('db_error');
  });
});

// ── PUT /api/canned-responses/:id ────────────────────────────────────────────

describe('PUT /api/canned-responses/:id', () => {
  it('updates title field', async () => {
    const updated = { ...CANNED_1, title: 'Updated greeting' };
    const pool = makeSequentialPool([
      [{ affectedRows: 1 }, []],
      [[updated], []],
    ]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .put('/api/canned-responses/1')
      .set('Authorization', AUTH)
      .send({ title: 'Updated greeting' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe('Updated greeting');
  });

  it('returns 404 when response does not exist', async () => {
    const pool = makeSequentialPool([
      [{ affectedRows: 0 }, []],
    ]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .put('/api/canned-responses/999')
      .set('Authorization', AUTH)
      .send({ title: 'New title' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('returns 400 when no fields are provided', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .put('/api/canned-responses/1')
      .set('Authorization', AUTH)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('no fields');
  });

  it('returns 400 for invalid channel in update', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .put('/api/canned-responses/1')
      .set('Authorization', AUTH)
      .send({ channel: 'telegram' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('invalid channel');
  });

  it('returns 400 for non-numeric id', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .put('/api/canned-responses/abc')
      .set('Authorization', AUTH)
      .send({ title: 'T' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('invalid id');
  });

  it('returns 401 without auth', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .put('/api/canned-responses/1')
      .send({ title: 'T' });

    expect(res.status).toBe(401);
  });

  it('returns 502 on db error', async () => {
    const pool = makePool(() => { throw new Error('db gone'); });
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .put('/api/canned-responses/1')
      .set('Authorization', AUTH)
      .send({ title: 'T' });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('db_error');
  });
});

// ── DELETE /api/canned-responses/:id ─────────────────────────────────────────

describe('DELETE /api/canned-responses/:id', () => {
  it('deletes an existing canned response', async () => {
    const pool = makePool(() => [{ affectedRows: 1 }, []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .delete('/api/canned-responses/1')
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 404 when response does not exist', async () => {
    const pool = makePool(() => [{ affectedRows: 0 }, []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .delete('/api/canned-responses/999')
      .set('Authorization', AUTH);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('returns 400 for non-numeric id', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .delete('/api/canned-responses/abc')
      .set('Authorization', AUTH);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('invalid id');
  });

  it('returns 401 without auth', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app).delete('/api/canned-responses/1');
    expect(res.status).toBe(401);
  });

  it('returns 502 on db error', async () => {
    const pool = makePool(() => { throw new Error('db gone'); });
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .delete('/api/canned-responses/1')
      .set('Authorization', AUTH);

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('db_error');
  });
});
