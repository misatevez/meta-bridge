import type { Express, Request, Response } from 'express';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { requireBridgeKey } from '../middleware/auth.js';
import {
  fetchTemplates,
  createTemplate,
  deleteTemplate,
  type WaTemplateComponent,
} from '../services/meta.js';

const VALID_CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const;

function isValidTemplateName(name: string): boolean {
  return /^[a-z0-9_]+$/.test(name);
}

export function registerTemplateRoutes(app: Express): void {
  app.get('/api/templates', requireBridgeKey, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const { id: wabaId, accessToken } = config.waba;

    if (!wabaId || !accessToken) {
      reqLog.info('WABA not configured — returning empty templates');
      res.json([]);
      return;
    }

    try {
      const allTemplates = await fetchTemplates(wabaId, accessToken);
      const statusFilter = typeof req.query['status'] === 'string' ? req.query['status'] : null;
      const templates = statusFilter
        ? allTemplates.filter((t) => t.status === statusFilter)
        : allTemplates;
      res.json(templates);
    } catch (err) {
      reqLog.error({ err }, 'failed to fetch Meta templates');
      res.status(502).json({ error: 'failed_to_fetch_templates' });
    }
  });

  app.post('/api/templates', requireBridgeKey, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const { id: wabaId, accessToken } = config.waba;

    const body = req.body as {
      name?: unknown;
      language?: unknown;
      category?: unknown;
      components?: unknown;
    };

    if (typeof body.name !== 'string' || !body.name.trim()) {
      res.status(400).json({ success: false, error: 'missing_field', field: 'name' });
      return;
    }
    if (!isValidTemplateName(body.name.trim())) {
      res.status(400).json({
        success: false,
        error: 'invalid_name',
        hint: 'name must be lowercase alphanumeric + underscores only',
      });
      return;
    }
    if (typeof body.language !== 'string' || !body.language.trim()) {
      res.status(400).json({ success: false, error: 'missing_field', field: 'language' });
      return;
    }
    if (typeof body.category !== 'string' || !VALID_CATEGORIES.includes(body.category as typeof VALID_CATEGORIES[number])) {
      res.status(400).json({
        success: false,
        error: 'invalid_category',
        valid: VALID_CATEGORIES,
      });
      return;
    }
    if (!Array.isArray(body.components) || body.components.length === 0) {
      res.status(400).json({ success: false, error: 'missing_field', field: 'components' });
      return;
    }

    if (!wabaId || !accessToken) {
      res.status(503).json({ success: false, error: 'waba_not_configured' });
      return;
    }

    try {
      const result = await createTemplate(wabaId, accessToken, {
        name: body.name.trim(),
        language: body.language.trim(),
        category: body.category,
        components: body.components as WaTemplateComponent[],
      });
      reqLog.info({ name: body.name, id: result.id }, 'template created');
      res.json({ success: true, id: result.id });
    } catch (err) {
      reqLog.error({ err, name: body.name }, 'failed to create template');
      res.status(502).json({ success: false, error: 'create_failed', detail: String(err) });
    }
  });

  app.delete('/api/templates/:name', requireBridgeKey, async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const { id: wabaId, accessToken } = config.waba;
    const name = String(req.params['name'] ?? '').trim();

    if (!name) {
      res.status(400).json({ success: false, error: 'missing_field', field: 'name' });
      return;
    }

    if (!wabaId || !accessToken) {
      res.status(503).json({ success: false, error: 'waba_not_configured' });
      return;
    }

    try {
      await deleteTemplate(wabaId, accessToken, name);
      reqLog.info({ name }, 'template deleted');
      res.json({ success: true });
    } catch (err) {
      reqLog.error({ err, name }, 'failed to delete template');
      res.status(502).json({ success: false, error: 'delete_failed', detail: String(err) });
    }
  });
}
