import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../logger.js';

export const MEDIA_BASE_DIR = '/opt/meta-bridge/media';

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/3gp': '3gp',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
};

function mimeToExt(mimeType: string): string {
  return MIME_TO_EXT[mimeType] ?? 'bin';
}

function sanitizeForPath(str: string): string {
  return str.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export interface DownloadResult {
  relativePath: string;
  mimeType: string;
  filename: string;
}

export async function downloadWhatsAppMedia(
  mediaId: string,
  accessToken: string,
  waId: string,
  timestamp: number,
  hintFilename?: string | null,
): Promise<DownloadResult | null> {
  try {
    const metaRes = await fetch(
      `https://graph.facebook.com/v21.0/${mediaId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!metaRes.ok) {
      logger.warn({ mediaId, status: metaRes.status }, 'media: Graph API metadata failed');
      return null;
    }
    const meta = await metaRes.json() as Record<string, unknown>;
    const url = typeof meta.url === 'string' ? meta.url : null;
    const mimeType = typeof meta.mime_type === 'string' ? meta.mime_type : 'application/octet-stream';
    if (!url) {
      logger.warn({ mediaId }, 'media: no url in Graph API response');
      return null;
    }

    const ext = mimeToExt(mimeType);
    const filename = hintFilename ?? `${timestamp}_${mediaId.slice(-8)}.${ext}`;
    const convDir = sanitizeForPath(waId);
    return await fetchAndSave(url, convDir, filename, mimeType, accessToken);
  } catch (err) {
    logger.warn({ err, mediaId }, 'media: WhatsApp download failed');
    return null;
  }
}

export async function downloadMessengerMedia(
  url: string,
  waId: string,
  timestamp: number,
  mimeType: string,
  hintFilename?: string | null,
): Promise<DownloadResult | null> {
  try {
    const ext = mimeToExt(mimeType);
    const filename = hintFilename ?? `${timestamp}_attachment.${ext}`;
    const convDir = sanitizeForPath(waId);
    return await fetchAndSave(url, convDir, filename, mimeType);
  } catch (err) {
    logger.warn({ err, url }, 'media: Messenger download failed');
    return null;
  }
}

async function fetchAndSave(
  url: string,
  convDir: string,
  filename: string,
  mimeType: string,
  authToken?: string,
): Promise<DownloadResult | null> {
  const destDir = path.join(MEDIA_BASE_DIR, convDir);
  fs.mkdirSync(destDir, { recursive: true });

  const headers: Record<string, string> = {};
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const res = await fetch(url, { headers });
  if (!res.ok || !res.body) {
    logger.warn({ url, status: res.status }, 'media: download request failed');
    return null;
  }

  const buffer = await res.arrayBuffer();
  const filePath = path.join(destDir, filename);
  await fs.promises.writeFile(filePath, Buffer.from(buffer));

  const relativePath = `${convDir}/${filename}`;
  logger.info({ filePath, mimeType }, 'media: downloaded successfully');
  return { relativePath, mimeType, filename };
}
