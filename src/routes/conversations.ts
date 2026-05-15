import type { Express, Request, Response } from 'express';
import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { logger } from '../logger.js';
import { requireBridgeKey, requireBridgeKeyOrWsJwt, type AuthenticatedRequest } from '../middleware/auth.js';
import type { Server as SocketIOServer } from 'socket.io';
import type { MessageStore, MessageStatusRow } from '../db/wa_messages.js';

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

interface NoteRow extends RowDataPacket {
  id: number;
  conversation_id: string;
  author: string;
  created_by: string | null;
  updated_by: string | null;
  content: string;
  created_at: Date;
  updated_at: Date | null;
}

interface UserRow extends RowDataPacket {
  id: string;
  is_admin: number;
}

interface AssignedConvRow extends RowDataPacket {
  assigned_user_id: string | null;
}

export function registerConversationRoutes(app: Express, firmasCrmPool: Pool, io?: SocketIOServer, messageStore?: MessageStore): void {
  app.get('/api/conversations', requireBridgeKey, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const assigned_to = req.query['assigned_to'] as string | undefined;

    try {
      let query = 'SELECT * FROM meta_conversations WHERE deleted = 0';
      const params: string[] = [];

      if (assigned_to !== undefined && assigned_to !== '') {
        query += ' AND assigned_user_id = ?';
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


  // GET /api/conversations/:id -- fetch single conversation (used by widget for assigned_to / channel)
  app.get('/api/conversations/:id', requireBridgeKeyOrWsJwt, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const id = req.params['id'] as string;
    try {
      const [rows] = await firmasCrmPool.query<ConversationRow[]>(
        'SELECT id, channel, assigned_user_id AS assigned_to, external_thread_id FROM meta_conversations WHERE id = ? AND deleted = 0 LIMIT 1',
        [id],
      );
      if (!rows.length) { res.status(404).json({ error: 'not_found' }); return; }
      res.json(rows[0]);
    } catch (err) {
      reqLog.error({ err, id }, 'failed to fetch conversation');
      res.status(502).json({ error: 'db_error' });
    }
  });

  app.post('/api/conversations/:id/assign', requireBridgeKeyOrWsJwt, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const id = req.params['id'] as string;
    const { assigned_to } = req.body as { assigned_to?: unknown };

    if (!assigned_to || typeof assigned_to !== 'string' || !assigned_to.trim()) {
      res.status(400).json({ success: false, error: 'missing_assigned_to' });
      return;
    }

    const assignee = assigned_to.trim();

    try {
      // Validate assignee is a real SuiteCRM user
      const [assigneeRows] = await firmasCrmPool.query<UserRow[]>(
        'SELECT id, is_admin FROM users WHERE id = ? AND deleted = 0',
        [assignee],
      );
      if (assigneeRows.length === 0) {
        res.status(400).json({ success: false, error: 'invalid_assignee' });
        return;
      }

      // WS JWT requests carry user identity — enforce role-based permission
      if (authReq.authMethod === 'ws_jwt') {
        const requestingUserId = authReq.jwtPayload?.sub;
        if (!requestingUserId) {
          res.status(403).json({ success: false, error: 'forbidden' });
          return;
        }

        const [requesterRows] = await firmasCrmPool.query<UserRow[]>(
          'SELECT id, is_admin FROM users WHERE id = ? AND deleted = 0',
          [requestingUserId],
        );
        if (requesterRows.length === 0) {
          res.status(403).json({ success: false, error: 'forbidden' });
          return;
        }

        const isAdmin = requesterRows[0]!.is_admin === 1;
        if (!isAdmin && requestingUserId !== assignee) {
          reqLog.warn({ requestingUserId, assignee }, 'non-admin tried to assign to another user');
          res.status(403).json({ success: false, error: 'forbidden' });
          return;
        }
      }

      await firmasCrmPool.query(
        'UPDATE meta_conversations SET assigned_user_id = ? WHERE id = ?',
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

  app.delete('/api/conversations/:id/assign', requireBridgeKeyOrWsJwt, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const id = req.params['id'] as string;

    try {
      // WS JWT requests carry user identity — enforce role-based permission
      if (authReq.authMethod === 'ws_jwt') {
        const requestingUserId = authReq.jwtPayload?.sub;
        if (!requestingUserId) {
          res.status(403).json({ success: false, error: 'forbidden' });
          return;
        }

        const [requesterRows] = await firmasCrmPool.query<UserRow[]>(
          'SELECT id, is_admin FROM users WHERE id = ? AND deleted = 0',
          [requestingUserId],
        );
        if (requesterRows.length === 0) {
          res.status(403).json({ success: false, error: 'forbidden' });
          return;
        }

        const isAdmin = requesterRows[0]!.is_admin === 1;
        if (!isAdmin) {
          // Non-admins can only unassign if the conversation is assigned to themselves
          const [convRows] = await firmasCrmPool.query<AssignedConvRow[]>(
            'SELECT assigned_user_id FROM meta_conversations WHERE id = ?',
            [id],
          );
          if (convRows.length === 0 || convRows[0]!.assigned_user_id !== requestingUserId) {
            reqLog.warn({ requestingUserId, id }, 'non-admin tried to unassign conversation not assigned to them');
            res.status(403).json({ success: false, error: 'forbidden' });
            return;
          }
        }
      }

      await firmasCrmPool.query(
        'UPDATE meta_conversations SET assigned_user_id = NULL WHERE id = ?',
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

  app.get('/api/unread-counts', async (req: Request, res: Response) => {
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

  app.post("/api/mark-read/:conversation_id", requireBridgeKeyOrWsJwt, async (req: Request, res: Response) => {
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

  app.get("/api/conversations/search", requireBridgeKeyOrWsJwt, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;

    const q = typeof req.query['q'] === 'string' ? req.query['q'].trim() : '';
    const channel = typeof req.query['channel'] === 'string' ? req.query['channel'].trim() : '';
    const assigned_to = typeof req.query['assigned_to'] === 'string' ? req.query['assigned_to'].trim() : '';

    if (q.length > 200) {
      res.status(400).json({ success: false, error: 'query_too_long' });
      return;
    }

    const ALLOWED_CHANNELS = new Set(['', 'whatsapp', 'facebook', 'messenger', 'instagram']);
    if (!ALLOWED_CHANNELS.has(channel)) {
      res.status(400).json({ success: false, error: 'invalid_channel' });
      return;
    }

    const conditions: string[] = ['c.deleted = 0'];
    const params: unknown[] = [];

    if (q) {
      // Escape LIKE metacharacters so user input is treated as a literal substring.
      const escaped = q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      const pattern = `%${escaped}%`;
      conditions.push('(c.display_name LIKE ? OR c.external_thread_id LIKE ? OR m.body LIKE ?)');
      params.push(pattern, pattern, pattern);
    }

    if (channel) {
      conditions.push('c.channel = ?');
      params.push(channel);
    }

    if (assigned_to) {
      conditions.push('c.assigned_user_id = ?');
      params.push(assigned_to);
    }

    const whereClause = conditions.join(' AND ');

    const sql = `
      SELECT DISTINCT
        c.id, c.channel, c.display_name, c.external_thread_id,
        c.unread_count, c.last_message_preview, c.last_message_at,
        c.status, c.assigned_user_id AS assigned_to, c.contact_id
      FROM meta_conversations c
      LEFT JOIN meta_messages m ON m.conversation_id = c.id AND m.deleted = 0
      WHERE ${whereClause}
      ORDER BY c.last_message_at DESC
      LIMIT 50
    `;

    try {
      const [rows] = await firmasCrmPool.query<ConversationRow[]>(sql, params);
      res.json({ conversations: rows });
    } catch (err) {
      reqLog.error({ err, q, channel, assigned_to }, 'failed to search conversations');
      res.status(502).json({ success: false, error: 'db_error' });
    }
  });

  app.get('/api/conversations/:id/notes', requireBridgeKeyOrWsJwt, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const id = (req.params['id'] as string).trim();

    if (!id) {
      res.status(400).json({ success: false, error: 'invalid_conversation_id' });
      return;
    }

    try {
      const [rows] = await firmasCrmPool.query<NoteRow[]>(
        'SELECT id, conversation_id, author, created_by, updated_by, content, created_at, updated_at FROM conversation_notes WHERE conversation_id = ? ORDER BY created_at ASC',
        [id],
      );
      res.json({ success: true, notes: rows });
    } catch (err) {
      reqLog.error({ err, id }, 'failed to list conversation notes');
      res.status(502).json({ success: false, error: 'db_error' });
    }
  });

  app.post('/api/conversations/:id/notes', requireBridgeKeyOrWsJwt, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const id = (req.params['id'] as string).trim();

    if (!id) {
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
        'INSERT INTO conversation_notes (conversation_id, author, created_by, content) VALUES (?, ?, ?, ?)',
        [id, author.trim(), author.trim(), content.trim()],
      );

      const insertId = result.insertId;

      const [rows] = await firmasCrmPool.query<NoteRow[]>(
        'SELECT id, conversation_id, author, created_by, updated_by, content, created_at, updated_at FROM conversation_notes WHERE id = ?',
        [insertId],
      );
      const note = rows[0];

      await firmasCrmPool.query(
        'INSERT INTO note_audit_log (note_id, conversation_id, action, user_id, new_content) VALUES (?, ?, ?, ?, ?)',
        [insertId, id, 'create', author.trim(), content.trim()],
      );

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

  app.put('/api/notes/:id', requireBridgeKeyOrWsJwt, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const id = parseInt(req.params['id'] as string, 10);

    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'invalid_note_id' });
      return;
    }

    const { user_id, content, is_admin } = req.body as { user_id?: string; content?: string; is_admin?: boolean };

    if (!user_id || typeof user_id !== 'string' || !user_id.trim()) {
      res.status(400).json({ success: false, error: 'missing_user_id' });
      return;
    }
    if (!content || typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ success: false, error: 'missing_content' });
      return;
    }

    try {
      const [existing] = await firmasCrmPool.query<NoteRow[]>(
        'SELECT id, conversation_id, created_by, content FROM conversation_notes WHERE id = ?',
        [id],
      );

      if (existing.length === 0) {
        res.status(404).json({ success: false, error: 'note_not_found' });
        return;
      }

      const note = existing[0]!;

      if (note.created_by && note.created_by !== user_id.trim() && !is_admin) {
        reqLog.warn({ noteId: id, created_by: note.created_by, user_id }, 'unauthorized note edit attempt');
        res.status(403).json({ success: false, error: 'forbidden' });
        return;
      }

      const oldContent = note.content;
      await firmasCrmPool.query(
        'UPDATE conversation_notes SET content = ?, updated_by = ? WHERE id = ?',
        [content.trim(), user_id.trim(), id],
      );

      await firmasCrmPool.query(
        'INSERT INTO note_audit_log (note_id, conversation_id, action, user_id, old_content, new_content) VALUES (?, ?, ?, ?, ?, ?)',
        [id, note.conversation_id, 'edit', user_id.trim(), oldContent, content.trim()],
      );

      const [updated] = await firmasCrmPool.query<NoteRow[]>(
        'SELECT id, conversation_id, author, created_by, updated_by, content, created_at, updated_at FROM conversation_notes WHERE id = ?',
        [id],
      );

      res.json({ success: true, note: updated[0] });
    } catch (err) {
      reqLog.error({ err, id }, 'failed to edit conversation note');
      res.status(502).json({ success: false, error: 'db_error' });
    }
  });

  app.delete('/api/notes/:id', requireBridgeKeyOrWsJwt, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const id = parseInt(req.params['id'] as string, 10);

    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'invalid_note_id' });
      return;
    }

    const { user_id, is_admin } = req.body as { user_id?: string; is_admin?: boolean };

    if (!user_id || typeof user_id !== 'string' || !user_id.trim()) {
      res.status(400).json({ success: false, error: 'missing_user_id' });
      return;
    }

    try {
      const [existing] = await firmasCrmPool.query<NoteRow[]>(
        'SELECT id, conversation_id, created_by, content FROM conversation_notes WHERE id = ?',
        [id],
      );

      if (existing.length === 0) {
        res.status(404).json({ success: false, error: 'note_not_found' });
        return;
      }

      const note = existing[0]!;

      if (note.created_by && note.created_by !== user_id.trim() && !is_admin) {
        reqLog.warn({ noteId: id, created_by: note.created_by, user_id }, 'unauthorized note delete attempt');
        res.status(403).json({ success: false, error: 'forbidden' });
        return;
      }

      await firmasCrmPool.query(
        'INSERT INTO note_audit_log (note_id, conversation_id, action, user_id, old_content) VALUES (?, ?, ?, ?, ?)',
        [id, note.conversation_id, 'delete', user_id.trim(), note.content],
      );

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
  app.get('/api/messages/:conversationId/statuses', async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const conversationId = req.params['conversationId'] as string;

    if (!conversationId || !conversationId.trim()) {
      res.status(400).json({ success: false, error: 'missing_conversation_id' });
      return;
    }

    if (!messageStore) {
      res.status(503).json({ success: false, error: 'store_unavailable' });
      return;
    }

    try {
      const rows: MessageStatusRow[] = await messageStore.getMessageStatuses(conversationId.trim());
      res.json({
        success: true,
        conversation_id: conversationId.trim(),
        messages: rows.map((r) => ({
          wamid: r.wamid,
          status: r.status,
          direction: r.direction,
          created_at: r.created_at,
        })),
      });
    } catch (err) {
      reqLog.error({ err, conversationId }, 'failed to query message statuses');
      res.status(502).json({ success: false, error: 'db_error' });
    }
  });

}
