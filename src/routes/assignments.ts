import type { Express, Request, Response } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { logger } from '../logger.js';
import { requireBridgeKey } from '../middleware/auth.js';

interface AssignmentRow extends RowDataPacket {
  id: number;
  wa_id: string | null;
  channel: string;
  sender_psid: string | null;
  contact_id_suitecrm: string | null;
  assigned_to: string;
  last_message_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export function registerAssignmentRoutes(app: Express, pool: Pool): void {
  app.get('/api/assignments', requireBridgeKey, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;

    try {
      const [rows] = await pool.query<AssignmentRow[]>(
        'SELECT * FROM meta_conversations WHERE assigned_to IS NOT NULL ORDER BY updated_at DESC LIMIT 100',
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      reqLog.error({ err }, 'failed to query assignments');
      res.status(502).json({ success: false, error: 'db_error' });
    }
  });
}
