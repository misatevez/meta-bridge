import { randomUUID } from 'node:crypto';
import axios from 'axios';
import type { Express, Request, Response } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { requireBridgeKey } from '../middleware/auth.js';
import { sendTextMessage } from '../services/meta.js';

const META_GRAPH_BASE = 'https://graph.facebook.com/v19.0';

export function registerSendRoutes(app: Express, firmasCrmPool: Pool): void {
  app.post('/api/send', requireBridgeKey, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;

    const body = req.body as { conversation_id?: unknown; text?: unknown };

    if (typeof body.conversation_id !== 'string' || !body.conversation_id.trim()) {
      res.status(400).json({ success: false, error: 'missing_required_fields', required: ['conversation_id', 'text'] });
      return;
    }
    if (typeof body.text !== 'string' || !body.text.trim()) {
      res.status(400).json({ success: false, error: 'missing_required_fields', required: ['conversation_id', 'text'] });
      return;
    }

    const conversationId = body.conversation_id.trim();
    const text = body.text.trim();

    let channel: string;
    let externalThreadId: string;

    try {
      interface ConvRow extends RowDataPacket {
        channel: string;
        external_thread_id: string;
        channel_id: string;
      }
      const [rows] = await firmasCrmPool.query<ConvRow[]>(
        'SELECT channel, external_thread_id, channel_id FROM meta_conversations WHERE id = ? AND deleted = 0 LIMIT 1',
        [conversationId],
      );

      if (!rows.length || !rows[0]) {
        res.status(404).json({ success: false, error: 'conversation_not_found' });
        return;
      }

      channel = rows[0].channel;
      externalThreadId = rows[0].external_thread_id;
    } catch (err) {
      reqLog.error({ err, conversationId }, 'failed to query firmascrm for conversation');
      res.status(502).json({ success: false, error: 'db_error' });
      return;
    }

    let externalId: string;

    try {
      if (channel === 'whatsapp') {
        const { phoneNumberId, accessToken } = config.waba;
        if (!phoneNumberId || !accessToken) {
          res.status(502).json({ success: false, error: 'waba_not_configured' });
          return;
        }
        const result = await sendTextMessage(phoneNumberId, accessToken, externalThreadId, text);
        externalId = result.wamid;
      } else if (channel === 'messenger' || channel === 'instagram') {
        const { pageAccessToken } = config.meta;
        if (!pageAccessToken) {
          res.status(502).json({ success: false, error: 'page_access_token_not_configured' });
          return;
        }
        const graphRes = await axios.post<{ message_id?: string }>(
          `${META_GRAPH_BASE}/me/messages`,
          {
            recipient: { id: externalThreadId },
            messaging_type: 'RESPONSE',
            message: { text },
          },
          {
            params: { access_token: pageAccessToken },
            timeout: 15_000,
            validateStatus: () => true,
          },
        );
        if (graphRes.status < 200 || graphRes.status >= 300) {
          reqLog.error({ channel, externalThreadId, status: graphRes.status, data: graphRes.data }, 'Graph API error');
          res.status(502).json({ success: false, error: 'graph_api_error', detail: graphRes.data });
          return;
        }
        externalId = graphRes.data.message_id ?? `sent-${Date.now()}`;
      } else {
        res.status(400).json({ success: false, error: 'unsupported_channel', channel });
        return;
      }
    } catch (err) {
      const e = err as { code?: string };
      if (e.code === 'outside_24h_window') {
        res.status(422).json({
          success: false,
          error: 'outside_24h_window',
          hint: 'Use /api/whatsapp/send-template instead',
        });
        return;
      }
      reqLog.error({ err, conversationId, channel }, 'failed to send message via Meta');
      res.status(502).json({ success: false, error: 'send_failed' });
      return;
    }

    const messageId = randomUUID();

    try {
      await firmasCrmPool.query(
        `INSERT INTO meta_messages
          (id, name, conversation_id, external_message_id, direction, message_type, body, sent_at, status,
           date_entered, date_modified, deleted, modified_user_id, created_by, assigned_user_id)
         VALUES (?, LEFT(?, 200), ?, ?, 'outgoing', 'text', ?, NOW(), 'sent', NOW(), NOW(), 0, '1', '1', '1')`,
        [messageId, text, conversationId, externalId, text],
      );

      await firmasCrmPool.query(
        'UPDATE meta_conversations SET last_message_preview = LEFT(?, 200), last_message_at = NOW() WHERE id = ?',
        [text, conversationId],
      );
    } catch (err) {
      reqLog.error({ err, conversationId, messageId }, 'failed to persist outgoing message to DB');
    }

    reqLog.info({ conversationId, channel, externalId, messageId }, 'unified send: message dispatched');
    res.status(202).json({ success: true, message_id: messageId, external_id: externalId });
  });
}
