import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { requireBridgeKey } from '../middleware/auth.js';
import { fetchTemplates, sendTemplateMessage, sendTemplateRaw, sendTextMessage } from '../services/meta.js';
import type { SendMessageInput, WaTemplate } from '../services/meta.js';

const MOCK_TEMPLATES: WaTemplate[] = [
  {
    name: 'hello_world',
    language: 'en_US',
    status: 'APPROVED',
    components: [{ type: 'BODY', text: 'Hello {{1}}! Welcome to our service.' }],
  },
  {
    name: 'bienvenida',
    language: 'es_AR',
    status: 'APPROVED',
    components: [{ type: 'BODY', text: 'Hola {{1}}, te damos la bienvenida a {{2}}.' }],
  },
];

interface ConversationRow extends RowDataPacket {
  id: string;
}

async function upsertTemplateConversation(
  pool: Pool,
  params: { phone: string; templateName: string; wamid: string; contactId: string | undefined; phoneNumberId: string; templateBody?: string },
): Promise<void> {
  const { templateName, wamid, contactId, phoneNumberId, templateBody } = params;
  // Strip leading + so external_thread_id matches how Meta delivers waId in webhooks
  const phone = params.phone.replace(/^\+/, "");
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute<ConversationRow[]>(
      'SELECT id FROM meta_conversations WHERE external_thread_id = ? AND channel = ? AND deleted = 0 LIMIT 1',
      [phone, 'whatsapp'],
    );

    let conversationId: string;
    if (rows.length > 0) {
      conversationId = rows[0]!.id;
      if (contactId) {
        await conn.execute(
          'UPDATE meta_conversations SET contact_id = ?, date_modified = NOW() WHERE id = ? AND (contact_id IS NULL OR contact_id = "")',
          [contactId, conversationId],
        );
      }
    } else {
      conversationId = randomUUID();
      const now = new Date();
      await conn.execute(
        `INSERT INTO meta_conversations
          (id, channel, channel_id, external_thread_id, contact_id, display_name, status, unread_count, date_entered, date_modified, deleted)
         VALUES (?, 'whatsapp', ?, ?, ?, ?, 'open', 0, ?, ?, 0)`,
        [conversationId, phoneNumberId, phone, contactId ?? '', phone, now, now],
      );
      logger.info({ conversationId, phone }, 'whatsapp: created meta_conversation for outbound template');
    }

    const body = templateBody || `Template: ${templateName}`;
    const messageId = randomUUID();
    await conn.execute(
      `INSERT INTO meta_messages
        (id, name, conversation_id, external_message_id, direction, message_type, body, sent_at, status,
         date_entered, date_modified, deleted, modified_user_id, created_by, assigned_user_id)
       VALUES (?, LEFT(?, 200), ?, ?, 'out', 'template', ?, NOW(), 'sent', NOW(), NOW(), 0, '1', '1', '1')`,
      [messageId, body, conversationId, wamid, body],
    );

    await conn.execute(
      'UPDATE meta_conversations SET last_message_preview = LEFT(?, 200), last_message_at = NOW(), date_modified = NOW() WHERE id = ?',
      [body, conversationId],
    );

    logger.info({ conversationId, wamid, messageId }, 'whatsapp: persisted outbound template message');
  } finally {
    conn.release();
  }
}

export function registerWhatsAppRoutes(app: Express, firmasCrmPool?: Pool): void {
  app.get('/channels/whatsapp/templates', requireBridgeKey, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const { id: wabaId, accessToken } = config.waba;

    if (!wabaId || !accessToken) {
      reqLog.info('WABA not configured — returning mock templates');
      res.json({ templates: MOCK_TEMPLATES, connected: false });
      return;
    }

    try {
      const templates = await fetchTemplates(wabaId, accessToken);
      res.json({ templates, connected: true });
    } catch (err) {
      reqLog.error({ err }, 'failed to fetch Meta templates');
      res.status(502).json({ error: 'failed_to_fetch_templates' });
    }
  });

  app.get('/api/whatsapp/templates', requireBridgeKey, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const { id: wabaId, accessToken } = config.waba;

    if (!wabaId || !accessToken) {
      reqLog.info('WABA not configured — returning empty templates');
      res.json({ templates: [], connected: false });
      return;
    }

    try {
      const allTemplates = await fetchTemplates(wabaId, accessToken);
      const templates = allTemplates
        .filter((t) => t.status === 'APPROVED')
        .map((t) => ({
          name: t.name,
          language: t.language,
          category: t.category,
          components: t.components,
        }));
      res.json({ templates, connected: true });
    } catch (err) {
      reqLog.error({ err }, 'failed to fetch Meta templates');
      res.status(502).json({ error: 'failed_to_fetch_templates' });
    }
  });

  app.post('/messages/whatsapp', requireBridgeKey, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;

    const body = req.body as {
      to?: unknown;
      template_name?: unknown;
      language?: unknown;
      variables?: unknown;
      contact_id?: unknown;
      account_id?: unknown;
      template_body?: unknown;
    };

    if (typeof body.to !== 'string' || !body.to.trim()) {
      res.status(400).json({ error: 'missing_required_fields', required: ['to', 'template_name'] });
      return;
    }
    if (typeof body.template_name !== 'string' || !body.template_name.trim()) {
      res.status(400).json({ error: 'missing_required_fields', required: ['to', 'template_name'] });
      return;
    }

    const input: SendMessageInput = {
      to: body.to.trim(),
      templateName: body.template_name.trim(),
      language: typeof body.language === 'string' && body.language ? body.language : 'es',
      variables: Array.isArray(body.variables) ? body.variables.map(String) : [],
      contactId: typeof body.contact_id === 'string' ? body.contact_id : undefined,
      accountId: typeof body.account_id === 'string' ? body.account_id : undefined,
    };

    const { phoneNumberId, accessToken } = config.waba;

    if (!phoneNumberId || !accessToken) {
      reqLog.info(
        { to: input.to, template: input.templateName },
        'WABA not configured — message queued (no-op)',
      );
      res.status(202).json({
        message_id: `queued-${Date.now()}`,
        status: 'queued',
        note: 'WABA channel not connected. Connect via Admin → Meta Bridge.',
      });
      return;
    }

    try {
      const result = await sendTemplateMessage(phoneNumberId, accessToken, input);
      reqLog.info(
        {
          wamid: result.wamid,
          to: input.to,
          template: input.templateName,
          contact_id: input.contactId,
        },
        'WhatsApp template message sent',
      );
      res.status(202).json({ message_id: result.wamid, status: 'pending' });

      if (firmasCrmPool) {
        upsertTemplateConversation(firmasCrmPool, {
          phone: input.to,
          templateName: input.templateName,
          wamid: result.wamid,
          contactId: input.contactId,
          phoneNumberId,
          templateBody: typeof body.template_body === 'string' ? body.template_body : undefined,
        }).catch((err) => {
          reqLog.error({ err, to: input.to, template: input.templateName }, 'failed to upsert conversation after template send');
        });
      }
    } catch (err) {
      reqLog.error({ err, to: input.to, template: input.templateName }, 'failed to send WhatsApp');
      const detail = err instanceof Error ? err.message : String(err); res.status(502).json({ error: "send_failed", detail });
    }
  });

  app.post('/api/whatsapp/send', requireBridgeKey, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;

    const body = req.body as { to?: unknown; text?: unknown };

    if (typeof body.to !== 'string' || !body.to.trim()) {
      res.status(400).json({ success: false, error: 'missing_required_fields', required: ['to', 'text'] });
      return;
    }
    if (typeof body.text !== 'string' || !body.text.trim()) {
      res.status(400).json({ success: false, error: 'missing_required_fields', required: ['to', 'text'] });
      return;
    }

    const to = body.to.trim();
    const text = body.text.trim();
    const { phoneNumberId, accessToken } = config.waba;

    if (!phoneNumberId || !accessToken) {
      reqLog.info({ to }, 'WABA not configured — free-text message queued (no-op)');
      res.status(202).json({
        success: true,
        wamid: `queued-${Date.now()}`,
        status: 'queued',
        note: 'WABA channel not connected.',
      });
      return;
    }

    try {
      const result = await sendTextMessage(phoneNumberId, accessToken, to, text);
      reqLog.info({ wamid: result.wamid, to }, 'WhatsApp free-text message sent');
      res.status(202).json({ success: true, wamid: result.wamid });
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
      reqLog.error({ err, to }, 'failed to send WhatsApp free-text');
      res.status(502).json({ success: false, error: 'send_failed' });
    }
  });

  app.post('/api/whatsapp/send-template', requireBridgeKey, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;

    const body = req.body as {
      to?: unknown;
      template_name?: unknown;
      language?: unknown;
      components?: unknown;
    };

    if (typeof body.to !== 'string' || !body.to.trim()) {
      res.status(400).json({ success: false, error: 'missing_required_fields', required: ['to', 'template_name'] });
      return;
    }
    if (typeof body.template_name !== 'string' || !body.template_name.trim()) {
      res.status(400).json({ success: false, error: 'missing_required_fields', required: ['to', 'template_name'] });
      return;
    }

    const to = body.to.trim();
    const templateName = body.template_name.trim();
    const language = typeof body.language === 'string' && body.language ? body.language : 'es';
    const components = Array.isArray(body.components) ? body.components : [];

    const { phoneNumberId, accessToken } = config.waba;

    if (!phoneNumberId || !accessToken) {
      reqLog.info({ to, template: templateName }, 'WABA not configured — template queued (no-op)');
      res.status(202).json({
        success: true,
        message_id: `queued-${Date.now()}`,
        status: 'queued',
        note: 'WABA channel not connected. Connect via Admin → Meta Bridge.',
      });
      return;
    }

    try {
      const result = await sendTemplateRaw(phoneNumberId, accessToken, { to, templateName, language, components });
      reqLog.info({ wamid: result.wamid, to, template: templateName }, 'WhatsApp template sent via send-template');
      res.status(202).json({ success: true, message_id: result.wamid });
    } catch (err) {
      reqLog.error({ err, to, template: templateName }, 'failed to send WhatsApp template');
      res.status(502).json({ success: false, error: 'send_failed' });
    }
  });
}
