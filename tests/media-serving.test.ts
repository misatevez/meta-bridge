import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { Pool } from 'mysql2/promise';

// Mock node:fs so the route never touches the real filesystem in unit tests.
vi.mock('node:fs', () => {
  const mockAccess = vi.fn();
  const mockStat = vi.fn();
  const mockCreateReadStream = vi.fn();
  return {
    default: {
      promises: { access: mockAccess, stat: mockStat },
      constants: { R_OK: 4 },
      createReadStream: mockCreateReadStream,
    },
    promises: { access: mockAccess, stat: mockStat },
    constants: { R_OK: 4 },
    createReadStream: mockCreateReadStream,
  };
});

import fs from 'node:fs';

function makeMetaPool(executeFn: (...args: unknown[]) => unknown): Pool {
  return {
    execute: vi.fn(executeFn),
    query: vi.fn(() => [[], []]),
  } as unknown as Pool;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: file exists and is readable (size 0 avoids Content-Length mismatch with empty mock stream)
  vi.mocked(fs.promises.access).mockResolvedValue(undefined);
  vi.mocked(fs.promises.stat).mockResolvedValue({ size: 0 } as import('fs').Stats);
  // Pipe mock: calls res.end() to finalize the response (no body, Content-Length: 0)
  vi.mocked(fs.createReadStream).mockReturnValue({
    pipe: vi.fn().mockImplementation((dest: { end: () => void }) => {
      dest.end();
      return dest;
    }),
  } as unknown as import('fs').ReadStream);
});

// ── Input validation ──────────────────────────────────────────────────────────

describe('GET /api/media/:messageId — input validation', () => {
  it('returns 400 for non-numeric message id', async () => {
    const app = createApp({ metaBridgePool: makeMetaPool(() => [[], []]) });
    const res = await request(app).get('/api/media/abc');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_id');
  });

  it('returns 400 for zero id', async () => {
    const app = createApp({ metaBridgePool: makeMetaPool(() => [[], []]) });
    const res = await request(app).get('/api/media/0');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_id');
  });

  it('returns 400 for negative id', async () => {
    const app = createApp({ metaBridgePool: makeMetaPool(() => [[], []]) });
    const res = await request(app).get('/api/media/-5');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_id');
  });
});

// ── DB lookup ─────────────────────────────────────────────────────────────────

describe('GET /api/media/:messageId — DB lookup', () => {
  it('returns 404 when media record does not exist in DB', async () => {
    const app = createApp({ metaBridgePool: makeMetaPool(() => [[], []]) });
    const res = await request(app).get('/api/media/999');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('returns 404 when file is missing on disk', async () => {
    const pool = makeMetaPool(() => [[{
      media_url: 'whatsapp_123/image.jpg',
      media_type: 'image/jpeg',
      media_filename: 'image.jpg',
    }], []]);
    const app = createApp({ metaBridgePool: pool });

    vi.mocked(fs.promises.access).mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );

    const res = await request(app).get('/api/media/1');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});

// ── Path traversal prevention ─────────────────────────────────────────────────

describe('GET /api/media/:messageId — path traversal prevention', () => {
  it('returns 400 when media_url escapes the base directory', async () => {
    const pool = makeMetaPool(() => [[{
      media_url: '../../../etc/passwd',
      media_type: 'text/plain',
      media_filename: null,
    }], []]);
    const app = createApp({ metaBridgePool: pool });

    const res = await request(app).get('/api/media/1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_path');
  });

  it('returns 400 for absolute path that escapes base dir', async () => {
    const pool = makeMetaPool(() => [[{
      media_url: '/etc/shadow',
      media_type: 'text/plain',
      media_filename: null,
    }], []]);
    const app = createApp({ metaBridgePool: pool });

    const res = await request(app).get('/api/media/2');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_path');
  });
});

// ── Successful serve ──────────────────────────────────────────────────────────

describe('GET /api/media/:messageId — successful serve', () => {
  it('returns 200 with correct Content-Type for a valid media record', async () => {
    const pool = makeMetaPool(() => [[{
      media_url: 'whatsapp_123/photo.jpg',
      media_type: 'image/jpeg',
      media_filename: 'photo.jpg',
    }], []]);
    const app = createApp({ metaBridgePool: pool });

    const res = await request(app).get('/api/media/1');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
  });

  it('sets Content-Disposition when media_filename is present', async () => {
    const pool = makeMetaPool(() => [[{
      media_url: 'whatsapp_123/doc.pdf',
      media_type: 'application/pdf',
      media_filename: 'invoice.pdf',
    }], []]);
    const app = createApp({ metaBridgePool: pool });

    const res = await request(app).get('/api/media/1');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('invoice.pdf');
  });

  it('falls back to application/octet-stream when media_type is empty', async () => {
    const pool = makeMetaPool(() => [[{
      media_url: 'whatsapp_123/file.bin',
      media_type: '',
      media_filename: null,
    }], []]);
    const app = createApp({ metaBridgePool: pool });

    const res = await request(app).get('/api/media/1');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/octet-stream');
  });
});
