import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { Pool } from 'mysql2/promise';

// ── helpers ──────────────────────────────────────────────────────────────────

const BRIDGE_KEY = 'test-bridge-key-abc123';
const BRIDGE_AUTH = `Bearer ${BRIDGE_KEY}`;
const WS_JWT_SECRET = 'test-ws-jwt-secret-for-tests-abc123'; // matches setup.ts

function makePool(queryFn: (...args: unknown[]) => unknown): Pool {
  return { query: vi.fn(queryFn) } as unknown as Pool;
}

function makeSequentialPool(responses: unknown[]): Pool {
  let call = 0;
  return { query: vi.fn(() => responses[call++] ?? [{ affectedRows: 0 }, []]) } as unknown as Pool;
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', WS_JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

const FUTURE_EXP = Math.floor(Date.now() / 1000) + 3600;

// ── GET /api/assignments ──────────────────────────────────────────────────────

describe('GET /api/assignments', () => {
  it('returns assigned conversations', async () => {
    const rows = [{ id: 'conv-1', assigned_to: 'user-a' }];
    const metaPool = makePool(() => [rows, []]);
    const app = createApp({ metaBridgePool: metaPool });

    const res = await request(app)
      .get('/api/assignments')
      .set('Authorization', BRIDGE_AUTH);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  it('returns empty list when no conversations are assigned', async () => {
    const metaPool = makePool(() => [[], []]);
    const app = createApp({ metaBridgePool: metaPool });

    const res = await request(app)
      .get('/api/assignments')
      .set('Authorization', BRIDGE_AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('returns 401 without auth', async () => {
    const metaPool = makePool(() => [[], []]);
    const app = createApp({ metaBridgePool: metaPool });

    const res = await request(app).get('/api/assignments');
    expect(res.status).toBe(401);
  });

  it('returns 502 on db error', async () => {
    const metaPool = makePool(() => { throw new Error('db gone'); });
    const app = createApp({ metaBridgePool: metaPool });

    const res = await request(app)
      .get('/api/assignments')
      .set('Authorization', BRIDGE_AUTH);

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('db_error');
  });
});

// ── POST /api/conversations/:id/assign ───────────────────────────────────────

describe('POST /api/conversations/:id/assign — bridge key', () => {
  it('assigns a conversation when assignee is valid', async () => {
    const pool = makeSequentialPool([
      [[{ id: 'user-a', is_admin: 0 }], []],  // assignee lookup
      [{ affectedRows: 1 }, []],               // UPDATE
    ]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .post('/api/conversations/conv-1/assign')
      .set('Authorization', BRIDGE_AUTH)
      .send({ assigned_to: 'user-a' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('emits conversation_assigned WS event', async () => {
    const pool = makeSequentialPool([
      [[{ id: 'user-a', is_admin: 0 }], []],
      [{ affectedRows: 1 }, []],
    ]);
    const emit = vi.fn();
    const io = { emit } as unknown as import('socket.io').Server;
    const app = createApp({ firmasCrmPool: pool, io });

    await request(app)
      .post('/api/conversations/conv-1/assign')
      .set('Authorization', BRIDGE_AUTH)
      .send({ assigned_to: 'user-a' });

    expect(emit).toHaveBeenCalledWith('conversation_assigned', {
      conversationId: 'conv-1',
      assigned_to: 'user-a',
    });
  });

  it('returns 400 when assigned_to is missing', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .post('/api/conversations/conv-1/assign')
      .set('Authorization', BRIDGE_AUTH)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_assigned_to');
  });

  it('returns 400 when assigned_to is not a valid user', async () => {
    const pool = makeSequentialPool([
      [[], []],  // assignee not found
    ]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .post('/api/conversations/conv-1/assign')
      .set('Authorization', BRIDGE_AUTH)
      .send({ assigned_to: 'nonexistent-user' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_assignee');
  });

  it('returns 401 without auth', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .post('/api/conversations/conv-1/assign')
      .send({ assigned_to: 'user-a' });

    expect(res.status).toBe(401);
  });

  it('returns 502 on db error', async () => {
    const pool = makePool(() => { throw new Error('db gone'); });
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .post('/api/conversations/conv-1/assign')
      .set('Authorization', BRIDGE_AUTH)
      .send({ assigned_to: 'user-a' });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('db_error');
  });
});

describe('POST /api/conversations/:id/assign — WS JWT permission checks', () => {
  it('non-admin can assign conversation to themselves', async () => {
    const userId = 'agent-x';
    const token = makeJwt({ sub: userId, exp: FUTURE_EXP });
    const pool = makeSequentialPool([
      [[{ id: userId, is_admin: 0 }], []],   // assignee lookup
      [[{ id: userId, is_admin: 0 }], []],   // requester lookup
      [{ affectedRows: 1 }, []],             // UPDATE
    ]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .post('/api/conversations/conv-1/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({ assigned_to: userId });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('non-admin cannot assign conversation to another user', async () => {
    const requesterId = 'agent-x';
    const assigneeId = 'agent-y';
    const token = makeJwt({ sub: requesterId, exp: FUTURE_EXP });
    const pool = makeSequentialPool([
      [[{ id: assigneeId, is_admin: 0 }], []],  // assignee lookup
      [[{ id: requesterId, is_admin: 0 }], []], // requester lookup
    ]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .post('/api/conversations/conv-1/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({ assigned_to: assigneeId });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('admin can assign conversation to another user', async () => {
    const adminId = 'admin-user';
    const assigneeId = 'agent-y';
    const token = makeJwt({ sub: adminId, exp: FUTURE_EXP });
    const pool = makeSequentialPool([
      [[{ id: assigneeId, is_admin: 0 }], []],  // assignee lookup
      [[{ id: adminId, is_admin: 1 }], []],     // requester (admin)
      [{ affectedRows: 1 }, []],                // UPDATE
    ]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .post('/api/conversations/conv-1/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({ assigned_to: assigneeId });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 403 when JWT has no sub claim', async () => {
    const token = makeJwt({ exp: FUTURE_EXP }); // no sub
    const pool = makeSequentialPool([
      [[{ id: 'some-user', is_admin: 0 }], []],
    ]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .post('/api/conversations/conv-1/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({ assigned_to: 'some-user' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('returns 401 for expired JWT', async () => {
    const token = makeJwt({ sub: 'user', exp: 1 }); // already expired
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .post('/api/conversations/conv-1/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({ assigned_to: 'user' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('token_expired');
  });
});

// ── DELETE /api/conversations/:id/assign ─────────────────────────────────────

describe('DELETE /api/conversations/:id/assign — bridge key', () => {
  it('unassigns a conversation', async () => {
    const pool = makePool(() => [{ affectedRows: 1 }, []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .delete('/api/conversations/conv-1/assign')
      .set('Authorization', BRIDGE_AUTH);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('emits conversation_assigned WS event with null assigned_to', async () => {
    const pool = makePool(() => [{ affectedRows: 1 }, []]);
    const emit = vi.fn();
    const io = { emit } as unknown as import('socket.io').Server;
    const app = createApp({ firmasCrmPool: pool, io });

    await request(app)
      .delete('/api/conversations/conv-1/assign')
      .set('Authorization', BRIDGE_AUTH);

    expect(emit).toHaveBeenCalledWith('conversation_assigned', {
      conversationId: 'conv-1',
      assigned_to: null,
    });
  });

  it('returns 401 without auth', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app).delete('/api/conversations/conv-1/assign');
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/conversations/:id/assign — WS JWT permission checks', () => {
  it('non-admin can unassign a conversation assigned to themselves', async () => {
    const userId = 'agent-x';
    const token = makeJwt({ sub: userId, exp: FUTURE_EXP });
    const pool = makeSequentialPool([
      [[{ id: userId, is_admin: 0 }], []],                   // requester lookup
      [[{ assigned_user_id: userId }], []],                  // conversation lookup
      [{ affectedRows: 1 }, []],                             // UPDATE
    ]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .delete('/api/conversations/conv-1/assign')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('non-admin cannot unassign a conversation assigned to another user', async () => {
    const userId = 'agent-x';
    const token = makeJwt({ sub: userId, exp: FUTURE_EXP });
    const pool = makeSequentialPool([
      [[{ id: userId, is_admin: 0 }], []],              // requester
      [[{ assigned_user_id: 'agent-y' }], []],          // conversation (assigned to someone else)
    ]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .delete('/api/conversations/conv-1/assign')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('admin can unassign any conversation', async () => {
    const adminId = 'admin-user';
    const token = makeJwt({ sub: adminId, exp: FUTURE_EXP });
    const pool = makeSequentialPool([
      [[{ id: adminId, is_admin: 1 }], []],  // requester (admin, skips conversation check)
      [{ affectedRows: 1 }, []],             // UPDATE
    ]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .delete('/api/conversations/conv-1/assign')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
