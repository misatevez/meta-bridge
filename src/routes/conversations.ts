import type { Express, Request, Response } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { logger } from '../logger.js';
import { requireBridgeKey } from '../middleware/auth.js';
import type { Server as SocketIOServer } from 'socket.io';

interface UnreadRow extends RowDataPacket {
  channel: string;
  count: number;
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
}
