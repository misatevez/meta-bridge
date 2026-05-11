import type { Express, Request, Response } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { logger } from '../logger.js';
import { requireBridgeKey } from '../middleware/auth.js';
import type { Server as SocketIOServer } from 'socket.io';

interface UnreadRow extends RowDataPacket {
  channel: string;
  count: number;
}

interface ConversationRow extends RowDataPacket {
  id: string;
  channel: string;
  channel_id: string;
  external_thread_id: string;
  contact_id: string | null;
  display_name: string | null;
  status: string;
  assigned_to: string | null;
  unread_count: number;
  last_message_preview: string | null;
  last_message_at: Date | null;
  date_entered: Date;
  date_modified: Date;
  deleted: number;
}

export function registerConversationRoutes(app: Express, firmasCrmPool: Pool, io?: SocketIOServer): void {
  app.get('/api/conversations', requireBridgeKey, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const assigned_to = req.query['assigned_to'] as string | undefined;

    try {
      let query = 'SELECT * FROM meta_conversations WHERE deleted = 0';
      const params: string[] = [];

      if (assigned_to !== undefined && assigned_to !== '') {
        query += ' AND assigned_to = ?';
        params.push(assigned_to);
      }

      query += ' ORDER BY date_modified DESC LIMIT 100';

      const [rows] = await firmasCrmPool.query<ConversationRow[]>(query, params);
      res.json({ success: true, data: rows });
    } catch (err) {
      reqLog.error({ err }, 'failed to query conversations');
      res.status(502).json({ success: false, error: 'db_error' });
    }
  });

  app.post('/api/conversations/:id/assign', requireBridgeKey, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const id = req.params['id'] as string;
    const { assigned_to } = req.body as { assigned_to?: unknown };

    if (!assigned_to || typeof assigned_to !== 'string' || !assigned_to.trim()) {
      res.status(400).json({ success: false, error: 'missing_assigned_to' });
      return;
    }

    const assignee = assigned_to.trim();

    try {
      await firmasCrmPool.query(
        'UPDATE meta_conversations SET assigned_to = ? WHERE id = ?',
        [assignee, id],
      );

      if (io) {
        io.emit('conversation_assigned', { conversationId: id, assigned_to: assignee });
        reqLog.debug({ id, assignee }, 'ws: conversation_assigned emitted');
      }

      res.json({ success: true });
    } catch (err) {
      reqLog.error({ err, id }, 'failed to assign conversation');
      res.status(502).json({ success: false, error: 'db_error' });
    }
  });

  app.delete('/api/conversations/:id/assign', requireBridgeKey, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const id = req.params['id'] as string;

    try {
      await firmasCrmPool.query(
        'UPDATE meta_conversations SET assigned_to = NULL WHERE id = ?',
        [id],
      );

      if (io) {
        io.emit('conversation_assigned', { conversationId: id, assigned_to: null });
        reqLog.debug({ id }, 'ws: conversation_assigned (unassign) emitted');
      }

      res.json({ success: true });
    } catch (err) {
      reqLog.error({ err, id }, 'failed to unassign conversation');
      res.status(502).json({ success: false, error: 'db_error' });
    }
  });

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
}
