import fs from 'node:fs';
import path from 'node:path';
import type { Express, Request, Response } from 'express';
import type { MetaMessageStore } from '../db/meta_messages.js';
import { MEDIA_BASE_DIR } from '../services/media-downloader.js';
import { logger } from '../logger.js';

export function registerMediaRoutes(app: Express, metaStore: MetaMessageStore): void {
  app.get('/api/media/:messageId', async (req: Request, res: Response) => {
    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    const rawId = String(req.params['messageId'] ?? '');
    const id = Number.parseInt(rawId, 10);

    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }

    try {
      const media = await metaStore.getMediaById(id);
      if (!media) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      // Resolve absolute path and prevent traversal
      const filePath = path.resolve(MEDIA_BASE_DIR, media.mediaUrl);
      const baseResolved = path.resolve(MEDIA_BASE_DIR);
      if (!filePath.startsWith(baseResolved + path.sep) && filePath !== baseResolved) {
        reqLog.warn({ id, mediaUrl: media.mediaUrl }, 'media: path traversal attempt');
        res.status(400).json({ error: 'invalid_path' });
        return;
      }

      try {
        await fs.promises.access(filePath, fs.constants.R_OK);
      } catch {
        reqLog.warn({ id, filePath }, 'media: file not found on disk');
        res.status(404).json({ error: 'not_found' });
        return;
      }

      const stat = await fs.promises.stat(filePath);
      res.setHeader('Content-Type', media.mediaType || 'application/octet-stream');
      res.setHeader('Content-Length', stat.size);
      if (media.mediaFilename) {
        res.setHeader('Content-Disposition', `inline; filename="${media.mediaFilename}"`);
      }
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      reqLog.error({ err, id }, 'media: failed to serve');
      if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
    }
  });
}
