import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { Pool } from 'mysql2/promise';

const BRIDGE_KEY = 'test-bridge-key-abc123';
const AUTH = `Bearer ${BRIDGE_KEY}`;

function makePool(queryFn: (...args: unknown[]) => unknown): Pool {
  return { query: vi.fn(queryFn) } as unknown as Pool;
}

/** Returns different responses per query call index. */
function makeSequentialPool(responses: unknown[]): Pool {
  let call = 0;
  return { query: vi.fn(() => responses[call++] ?? [{ affectedRows: 0 }, []]) } as unknown as Pool;
}

const NOTE_1 = {
  id: 1,
  conversation_id: '42',
  author: 'Agent Smith',
  created_by: 'user1',
  updated_by: null,
  content: 'Follow up needed',
  created_at: new Date('2026-05-11T00:00:00Z'),
  updated_at: null,
};

describe('GET /api/conversations/:id/notes', () => {
  it('returns notes for a conversation', async () => {
    const pool = makePool(() => [[NOTE_1], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .get('/api/conversations/42/notes')
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.notes).toHaveLength(1);
    expect(res.body.notes[0].id).toBe(1);
    expect(res.body.notes[0].author).toBe('Agent Smith');
  });

  it('returns empty array when no notes exist', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .get('/api/conversations/99/notes')
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.notes).toEqual([]);
  });

  it('accepts UUID-style conversation ids', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .get('/api/conversations/abc-uuid-123/notes')
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
  });

  it('returns 401 without auth', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app).get('/api/conversations/42/notes');
    expect(res.status).toBe(401);
  });

  it('returns 502 on db error', async () => {
    const pool = makePool(() => { throw new Error('connection lost'); });
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .get('/api/conversations/42/notes')
      .set('Authorization', AUTH);

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('db_error');
  });
});

describe('POST /api/conversations/:id/notes', () => {
  it('creates a note and returns it', async () => {
    const pool = makeSequentialPool([
      [{ insertId: 5, affectedRows: 1 }, []],
      [[{ ...NOTE_1, id: 5 }], []],
      [{ affectedRows: 1 }, []],
    ]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .post('/api/conversations/42/notes')
      .set('Authorization', AUTH)
      .send({ author: 'Agent Smith', content: 'Follow up needed' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.note.id).toBe(5);
  });

  it('emits note_added WS event on creation', async () => {
    const pool = makeSequentialPool([
      [{ insertId: 7, affectedRows: 1 }, []],
      [[{ ...NOTE_1, id: 7 }], []],
      [{ affectedRows: 1 }, []],
    ]);
    const emit = vi.fn();
    const io = { emit } as unknown as import('socket.io').Server;
    const app = createApp({ firmasCrmPool: pool, io });

    await request(app)
      .post('/api/conversations/42/notes')
      .set('Authorization', AUTH)
      .send({ author: 'Smith', content: 'Testing WS' });

    expect(emit).toHaveBeenCalledWith('note_added', expect.objectContaining({ conversationId: '42' }));
  });

  it('returns 400 when author is missing', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .post('/api/conversations/42/notes')
      .set('Authorization', AUTH)
      .send({ content: 'No author' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_author');
  });

  it('returns 400 when content is missing', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .post('/api/conversations/42/notes')
      .set('Authorization', AUTH)
      .send({ author: 'Smith' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_content');
  });

  it('returns 401 without auth', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .post('/api/conversations/42/notes')
      .send({ author: 'Smith', content: 'Test' });

    expect(res.status).toBe(401);
  });

  it('returns 502 on db error', async () => {
    const pool = makePool(() => { throw new Error('connection lost'); });
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .post('/api/conversations/42/notes')
      .set('Authorization', AUTH)
      .send({ author: 'Smith', content: 'Test' });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('db_error');
  });
});

describe('PUT /api/notes/:id', () => {
  it('updates note content successfully', async () => {
    const updatedNote = { ...NOTE_1, content: 'updated content', updated_by: 'user1' };
    const pool = makeSequentialPool([
      [[{ id: 1, conversation_id: '42', created_by: 'user1', content: 'original' }], []],
      [{ affectedRows: 1 }, []],
      [{ affectedRows: 1 }, []],
      [[updatedNote], []],
    ]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .put('/api/notes/1')
      .set('Authorization', AUTH)
      .send({ user_id: 'user1', content: 'updated content' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.note.content).toBe('updated content');
  });

  it('returns 403 when non-owner tries to edit', async () => {
    const pool = makePool(() => [[{ id: 1, conversation_id: '42', created_by: 'owner-user', content: 'original' }], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .put('/api/notes/1')
      .set('Authorization', AUTH)
      .send({ user_id: 'other-user', content: 'hacked' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('allows admin to edit any note', async () => {
    const updatedNote = { ...NOTE_1, content: 'admin edit', updated_by: 'admin-user' };
    const pool = makeSequentialPool([
      [[{ id: 1, conversation_id: '42', created_by: 'owner-user', content: 'original' }], []],
      [{ affectedRows: 1 }, []],
      [{ affectedRows: 1 }, []],
      [[updatedNote], []],
    ]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .put('/api/notes/1')
      .set('Authorization', AUTH)
      .send({ user_id: 'admin-user', content: 'admin edit', is_admin: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 400 when content is missing', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .put('/api/notes/1')
      .set('Authorization', AUTH)
      .send({ user_id: 'user1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_content');
  });

  it('returns 400 when user_id is missing', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .put('/api/notes/1')
      .set('Authorization', AUTH)
      .send({ content: 'new content' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_user_id');
  });

  it('returns 404 when note does not exist', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .put('/api/notes/999')
      .set('Authorization', AUTH)
      .send({ user_id: 'user1', content: 'content' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('note_not_found');
  });

  it('returns 400 for non-numeric note id', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .put('/api/notes/abc')
      .set('Authorization', AUTH)
      .send({ user_id: 'user1', content: 'content' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_note_id');
  });

  it('returns 401 without auth', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .put('/api/notes/1')
      .send({ user_id: 'user1', content: 'content' });

    expect(res.status).toBe(401);
  });

  it('returns 502 on db error', async () => {
    const pool = makePool(() => { throw new Error('db gone'); });
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .put('/api/notes/1')
      .set('Authorization', AUTH)
      .send({ user_id: 'user1', content: 'content' });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('db_error');
  });
});

describe('DELETE /api/notes/:id', () => {
  it('deletes a note successfully', async () => {
    const pool = makeSequentialPool([
      [[{ id: 1, conversation_id: '42', created_by: 'user1', content: 'test' }], []],
      [{ affectedRows: 1 }, []],
      [{ affectedRows: 1 }, []],
    ]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .delete('/api/notes/1')
      .set('Authorization', AUTH)
      .send({ user_id: 'user1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 403 when non-owner tries to delete', async () => {
    const pool = makePool(() => [[{ id: 1, conversation_id: '42', created_by: 'owner-user', content: 'test' }], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .delete('/api/notes/1')
      .set('Authorization', AUTH)
      .send({ user_id: 'other-user' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('allows admin to delete any note', async () => {
    const pool = makeSequentialPool([
      [[{ id: 1, conversation_id: '42', created_by: 'owner-user', content: 'test' }], []],
      [{ affectedRows: 1 }, []],
      [{ affectedRows: 1 }, []],
    ]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .delete('/api/notes/1')
      .set('Authorization', AUTH)
      .send({ user_id: 'admin-user', is_admin: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 400 when user_id is missing', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .delete('/api/notes/1')
      .set('Authorization', AUTH);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_user_id');
  });

  it('returns 404 when note does not exist', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .delete('/api/notes/999')
      .set('Authorization', AUTH)
      .send({ user_id: 'some-user' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('note_not_found');
  });

  it('returns 400 for non-numeric note id', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .delete('/api/notes/abc')
      .set('Authorization', AUTH);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_note_id');
  });

  it('returns 401 without auth', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app).delete('/api/notes/1');
    expect(res.status).toBe(401);
  });

  it('returns 502 on db error', async () => {
    const pool = makePool(() => { throw new Error('connection lost'); });
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .delete('/api/notes/1')
      .set('Authorization', AUTH)
      .send({ user_id: 'some-user' });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('db_error');
  });
});
