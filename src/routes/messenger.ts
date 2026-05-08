import axios from 'axios';
import type { Express, Request, Response } from 'express';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { requireBridgeKey } from '../middleware/auth.js';

const META_GRAPH_BASE = 'https://graph.facebook.com/v19.0';

export function registerMessengerRoutes(app: Express): void {
  app.post('/api/messenger/send', requireBridgeKey, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;

    const body = req.body as { psid?: unknown; text?: unknown };

    if (typeof body.psid !== 'string' || !body.psid.trim()) {
      res.status(400).json({ error: 'missing_required_fields', required: ['psid', 'text'] });
      return;
    }
    if (typeof body.text !== 'string' || !body.text.trim()) {
      res.status(400).json({ error: 'missing_required_fields', required: ['psid', 'text'] });
      return;
    }

    const psid = body.psid.trim();
    const text = body.text.trim();
    const { pageAccessToken } = config.meta;

    if (!pageAccessToken) {
      reqLog.info({ psid }, 'Page Access Token not configured — message queued (no-op)');
      res.status(202).json({
        success: true,
        message_id: `queued-${Date.now()}`,
        status: 'queued',
        note: 'Messenger channel not connected. Configure PAGE_ACCESS_TOKEN.',
      });
      return;
    }

    try {
      const graphRes = await axios.post<{ message_id?: string; recipient_id?: string }>(
        `${META_GRAPH_BASE}/me/messages`,
        {
          recipient: { id: psid },
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
        reqLog.error(
          { psid, status: graphRes.status, data: graphRes.data },
          'Graph API error sending Messenger message',
        );
        res.status(502).json({
          success: false,
          error: 'graph_api_error',
          detail: graphRes.data,
        });
        return;
      }

      reqLog.info(
        { psid, message_id: graphRes.data.message_id },
        'Messenger message sent',
      );
      res.status(202).json({
        success: true,
        message_id: graphRes.data.message_id ?? `sent-${Date.now()}`,
      });
    } catch (err) {
      reqLog.error({ err, psid }, 'failed to send Messenger message');
      res.status(502).json({ success: false, error: 'send_failed' });
    }
  });
}
