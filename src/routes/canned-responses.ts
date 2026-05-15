import type { Express, Request, Response } from 'express';
import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { logger } from '../logger.js';
import { requireBridgeKey, requireBridgeKeyOrWsJwt } from '../middleware/auth.js';

interface CannedResponseRow extends RowDataPacket {
  id: number;
  title: string;
  content: string;
  channel: 'whatsapp' | 'messenger' | 'instagram' | 'all';
  shortcut: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

// canned_responses lives in meta_bridge DB; pool may connect to firmascrm DB,
// so all queries use fully-qualified table name.
const TABLE = 'meta_bridge.canned_responses';

const VALID_CHANNELS = ['whatsapp', 'messenger', 'instagram', 'all'];

export function registerCannedResponseRoutes(app: Express, pool: Pool): void {
  app.get('/api/canned-responses', requireBridgeKeyOrWsJwt, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const { channel, created_by } = req.query;

    try {
      let query = `SELECT * FROM ${TABLE}`;
      const params: string[] = [];
      const conditions: string[] = [];

      if (channel && typeof channel === 'string') {
        conditions.push('(channel = ? OR channel = "all")');
        params.push(channel);
      }

      if (created_by && typeof created_by === 'string') {
        conditions.push('created_by = ?');
        params.push(created_by);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' ORDER BY id ASC';

      const [rows] = await pool.query<CannedResponseRow[]>(query, params);
      res.json({ success: true, data: rows });
    } catch (err) {
      reqLog.error({ err }, 'failed to list canned responses');
      res.status(502).json({ success: false, error: 'db_error' });
    }
  });

  app.post('/api/canned-responses', requireBridgeKeyOrWsJwt, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const { title, content, channel = 'all', shortcut, created_by } = req.body as {
      title?: string;
      content?: string;
      channel?: string;
      shortcut?: string;
      created_by?: string;
    };

    if (!title || !content) {
      res.status(400).json({ success: false, error: 'title and content are required' });
      return;
    }

    if (!VALID_CHANNELS.includes(channel)) {
      res.status(400).json({ success: false, error: 'invalid channel' });
      return;
    }

    try {
      const [result] = await pool.query<ResultSetHeader>(
        `INSERT INTO ${TABLE} (title, content, channel, shortcut, created_by) VALUES (?, ?, ?, ?, ?)`,
        [title.trim(), content.trim(), channel, shortcut?.trim() ?? null, created_by?.trim() ?? null],
      );

      const [rows] = await pool.query<CannedResponseRow[]>(
        `SELECT * FROM ${TABLE} WHERE id = ?`,
        [result.insertId],
      );

      res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      reqLog.error({ err }, 'failed to create canned response');
      res.status(502).json({ success: false, error: 'db_error' });
    }
  });

  app.put('/api/canned-responses/:id', requireBridgeKeyOrWsJwt, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const id = Number(req.params['id']);

    if (!id || isNaN(id)) {
      res.status(400).json({ success: false, error: 'invalid id' });
      return;
    }

    const { title, content, channel, shortcut } = req.body as {
      title?: string;
      content?: string;
      channel?: string;
      shortcut?: string;
    };

    if (!title && !content && !channel && shortcut === undefined) {
      res.status(400).json({ success: false, error: 'no fields to update' });
      return;
    }

    if (channel && !VALID_CHANNELS.includes(channel)) {
      res.status(400).json({ success: false, error: 'invalid channel' });
      return;
    }

    try {
      const fields: string[] = [];
      const values: (string | null)[] = [];

      if (title) { fields.push('title = ?'); values.push(title.trim()); }
      if (content) { fields.push('content = ?'); values.push(content.trim()); }
      if (channel) { fields.push('channel = ?'); values.push(channel); }
      if (shortcut !== undefined) { fields.push('shortcut = ?'); values.push(shortcut?.trim() ?? null); }

      values.push(String(id));
      const [result] = await pool.query<ResultSetHeader>(
        `UPDATE ${TABLE} SET ${fields.join(', ')} WHERE id = ?`,
        values,
      );

      if (result.affectedRows === 0) {
        res.status(404).json({ success: false, error: 'not_found' });
        return;
      }

      const [rows] = await pool.query<CannedResponseRow[]>(
        `SELECT * FROM ${TABLE} WHERE id = ?`,
        [id],
      );

      res.json({ success: true, data: rows[0] });
    } catch (err) {
      reqLog.error({ err, id }, 'failed to update canned response');
      res.status(502).json({ success: false, error: 'db_error' });
    }
  });

  app.delete('/api/canned-responses/:id', requireBridgeKeyOrWsJwt, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const id = Number(req.params['id']);

    if (!id || isNaN(id)) {
      res.status(400).json({ success: false, error: 'invalid id' });
      return;
    }

    try {
      const [result] = await pool.query<ResultSetHeader>(
        `DELETE FROM ${TABLE} WHERE id = ?`,
        [id],
      );

      if (result.affectedRows === 0) {
        res.status(404).json({ success: false, error: 'not_found' });
        return;
      }

      res.json({ success: true });
    } catch (err) {
      reqLog.error({ err, id }, 'failed to delete canned response');
      res.status(502).json({ success: false, error: 'db_error' });
    }
  });
}
