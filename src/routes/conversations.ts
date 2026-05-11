import type { Express, Request, Response } from 'express';
import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { logger } from '../logger.js';
import { requireBridgeKey } from '../middleware/auth.js';
import type { Server as SocketIOServer } from 'socket.io';

interface UnreadRow extends RowDataPacket {
  channel: string;
  count: number;
}

interface NoteRow extends RowDataPacket {
  id: number;
  conversation_id: number;
  author: string;
  content: string;
  created_at: Date;
}

export function registerConversationRoutes(app: Express, firmasCrmPool: Pool, io?: SocketIOServer): void {
  app.get('/api/unread-counts', requireBridgeKey, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;

    try {
      const [rows] = await firmasCrmPool.query<UnreadRow[]>(
        'SELECT channel, SUM(unread_count) as count FROM meta_conversations WHERE deleted = 0 GROUP BY channel',
      );

      let whatsapp = 0;
      let facebook = 0;
      let instagram = 0;

      for (const row of rows) {
        if (row.channel === 'whatsapp') whatsapp = Number(row.count);
        else if (row.channel === 'facebook') facebook = Number(row.count);
        else if (row.channel === 'instagram') instagram = Number(row.count);
      }

      res.json({
        whatsapp,
        facebook,
        instagram,
        total: whatsapp + facebook + instagram,
      });
    } catch (err) {
      reqLog.error({ err }, 'failed to query unread counts');
      res.status(502).json({ success: false, error: 'db_error' });
    }
  });

  app.post('/api/mark-read/:conversation_id', requireBridgeKey, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const conversation_id = req.params['conversation_id'] as string;

    if (!conversation_id || !conversation_id.trim()) {
      res.status(400).json({ success: false, error: 'missing_conversation_id' });
      return;
    }

    try {
      await firmasCrmPool.query(
        'UPDATE meta_conversations SET unread_count = 0 WHERE id = ?',
        [conversation_id.trim()],
      );

      if (io) {
        try {
          const [rows] = await firmasCrmPool.query<UnreadRow[]>(
            'SELECT channel, SUM(unread_count) as count FROM meta_conversations WHERE deleted = 0 GROUP BY channel',
          );
          let whatsapp = 0;
          let facebook = 0;
          let instagram = 0;
          for (const row of rows) {
            if (row.channel === 'whatsapp') whatsapp = Number(row.count);
            else if (row.channel === 'facebook') facebook = Number(row.count);
            else if (row.channel === 'instagram') instagram = Number(row.count);
          }
          const counts = { whatsapp, facebook, instagram, total: whatsapp + facebook + instagram };
          io.emit('unread_update', counts);
          reqLog.debug({ counts, conversation_id }, 'ws: unread_update emitted after mark-read');
        } catch (err) {
          reqLog.error({ err }, 'ws: failed to emit unread_update after mark-read');
        }
      }

      res.json({ success: true });
    } catch (err) {
      reqLog.error({ err, conversation_id }, 'failed to mark conversation as read');
      res.status(502).json({ success: false, error: 'db_error' });
    }
  });

  app.get('/api/conversations/:id/notes', requireBridgeKey, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const id = parseInt(req.params['id'] as string, 10);

    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'invalid_conversation_id' });
      return;
    }

    try {
      const [rows] = await firmasCrmPool.query<NoteRow[]>(
        'SELECT id, conversation_id, author, content, created_at FROM conversation_notes WHERE conversation_id = ? ORDER BY created_at ASC',
        [id],
      );
      res.json({ success: true, notes: rows });
    } catch (err) {
      reqLog.error({ err, id }, 'failed to list conversation notes');
      res.status(502).json({ success: false, error: 'db_error' });
    }
  });

  app.post('/api/conversations/:id/notes', requireBridgeKey, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const id = parseInt(req.params['id'] as string, 10);

    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'invalid_conversation_id' });
      return;
    }

    const { author, content } = req.body as { author?: string; content?: string };

    if (!author || typeof author !== 'string' || !author.trim()) {
      res.status(400).json({ success: false, error: 'missing_author' });
      return;
    }
    if (!content || typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ success: false, error: 'missing_content' });
      return;
    }

    try {
      const [result] = await firmasCrmPool.query<ResultSetHeader>(
        'INSERT INTO conversation_notes (conversation_id, author, content) VALUES (?, ?, ?)',
        [id, author.trim(), content.trim()],
      );

      const [rows] = await firmasCrmPool.query<NoteRow[]>(
        'SELECT id, conversation_id, author, content, created_at FROM conversation_notes WHERE id = ?',
        [result.insertId],
      );
      const note = rows[0];

      if (io) {
        io.emit('note_added', { conversationId: id, note });
        reqLog.debug({ conversationId: id, noteId: note?.id }, 'ws: note_added emitted');
      }

      res.status(201).json({ success: true, note });
    } catch (err) {
      reqLog.error({ err, id }, 'failed to create conversation note');
      res.status(502).json({ success: false, error: 'db_error' });
    }
  });

  app.delete('/api/notes/:id', requireBridgeKey, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const id = parseInt(req.params['id'] as string, 10);

    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'invalid_note_id' });
      return;
    }

    try {
      const [result] = await firmasCrmPool.query<ResultSetHeader>(
        'DELETE FROM conversation_notes WHERE id = ?',
        [id],
      );

      if (result.affectedRows === 0) {
        res.status(404).json({ success: false, error: 'note_not_found' });
        return;
      }

      res.json({ success: true });
    } catch (err) {
      reqLog.error({ err, id }, 'failed to delete conversation note');
      res.status(502).json({ success: false, error: 'db_error' });
    }
  });
}
