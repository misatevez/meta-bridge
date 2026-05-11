import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { Pool } from 'mysql2/promise';

const BRIDGE_KEY = 'test-bridge-key-abc123';
const AUTH = `Bearer ${BRIDGE_KEY}`;

function makePool(queryFn: (...args: unknown[]) => unknown): Pool {
  return { query: vi.fn(queryFn) } as unknown as Pool;
}

const NOTE_1 = {
  id: 1,
  conversation_id: 42,
  author: 'Agent Smith',
  content: 'Follow up needed',
  created_at: new Date('2026-05-11T00:00:00Z'),
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

  it('returns 400 for non-numeric conversation id', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .get('/api/conversations/abc/notes')
      .set('Authorization', AUTH);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_conversation_id');
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
    let callCount = 0;
    const pool = makePool(() => {
      callCount++;
      if (callCount === 1) return [{ insertId: 5, affectedRows: 1 }, []];
      return [[{ ...NOTE_1, id: 5 }], []];
    });
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
    let callCount = 0;
    const pool = makePool(() => {
      callCount++;
      if (callCount === 1) return [{ insertId: 7, affectedRows: 1 }, []];
      return [[{ ...NOTE_1, id: 7 }], []];
    });
    const emit = vi.fn();
    const io = { emit } as unknown as import('socket.io').Server;
    const app = createApp({ firmasCrmPool: pool, io });

    await request(app)
      .post('/api/conversations/42/notes')
      .set('Authorization', AUTH)
      .send({ author: 'Smith', content: 'Testing WS' });

    expect(emit).toHaveBeenCalledWith('note_added', expect.objectContaining({ conversationId: 42 }));
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

  it('returns 400 for non-numeric conversation id', async () => {
    const pool = makePool(() => [[], []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .post('/api/conversations/abc/notes')
      .set('Authorization', AUTH)
      .send({ author: 'Smith', content: 'Test' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_conversation_id');
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

describe('DELETE /api/notes/:id', () => {
  it('deletes a note successfully', async () => {
    const pool = makePool(() => [{ affectedRows: 1 }, []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .delete('/api/notes/1')
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 404 when note does not exist', async () => {
    const pool = makePool(() => [{ affectedRows: 0 }, []]);
    const app = createApp({ firmasCrmPool: pool });

    const res = await request(app)
      .delete('/api/notes/999')
      .set('Authorization', AUTH);

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
      .set('Authorization', AUTH);

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('db_error');
  });
});
