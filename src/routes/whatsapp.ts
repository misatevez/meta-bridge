import type { Express, Request, Response } from 'express';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { requireBridgeKey } from '../middleware/auth.js';
import { fetchTemplates, sendTemplateMessage, sendTemplateRaw } from '../services/meta.js';
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

export function registerWhatsAppRoutes(app: Express): void {
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

  app.post('/messages/whatsapp', requireBridgeKey, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;

    const body = req.body as {
      to?: unknown;
      template_name?: unknown;
      language?: unknown;
      variables?: unknown;
      contact_id?: unknown;
      account_id?: unknown;
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
    } catch (err) {
      reqLog.error({ err, to: input.to, template: input.templateName }, 'failed to send WhatsApp');
      res.status(502).json({ error: 'send_failed' });
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
