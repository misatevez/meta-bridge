import { randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { logger } from '../logger.js';

interface ConversationRow extends RowDataPacket {
  id: string;
}

interface ContactRow extends RowDataPacket {
  contact_id: string;
}

export interface SyncMessageParams {
  waId: string;
  wamid: string;
  body: string | null;
  timestamp: number;
  messageType: string;
  direction: 'in' | 'out';
  profileName: string;
  contactIdSuitecrm: string | null;
  phoneNumberId: string;
  channel?: 'whatsapp' | 'messenger' | 'instagram';
}

export interface SuiteCrmSyncService {
  syncMessage(params: SyncMessageParams): Promise<void>;
}

async function resolveGraphAPIDisplayName(id: string, pageAccessToken: string, cache: Map<string, string>): Promise<string> {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;

  try {
    const url = `https://graph.facebook.com/v19.0/${id}?fields=name&access_token=${pageAccessToken}`;
    const res = await fetch(url);
    if (!res.ok) {
      logger.warn({ id, status: res.status }, 'Graph API name lookup failed, using ID as fallback');
      cache.set(id, id);
      return id;
    }
    const data = await res.json() as Record<string, unknown>;
    const name = typeof data.name === 'string' && data.name.length > 0 ? data.name : id;
    cache.set(id, name);
    return name;
  } catch (err) {
    logger.warn({ err, id }, 'Graph API name lookup error, using ID as fallback');
    cache.set(id, id);
    return id;
  }
}

export function createSuiteCrmSyncService(pool: Pool, pageAccessToken = ''): SuiteCrmSyncService {
  const socialContactsCache = new Map<string, string>();

  return {
    async syncMessage(params) {
      try {
        await doSync(pool, params, pageAccessToken, socialContactsCache);
      } catch (err) {
        logger.error({ err, wamid: params.wamid, waId: params.waId }, 'suitecrm-sync: failed — not blocking webhook');
      }
    },
  };
}

async function doSync(pool: Pool, params: SyncMessageParams, pageAccessToken: string, socialContactsCache: Map<string, string>): Promise<void> {
  const {
    waId,
    wamid,
    body,
    timestamp,
    messageType,
    direction,
    profileName,
    contactIdSuitecrm,
    phoneNumberId,
    channel = 'whatsapp',
  } = params;

  // For Messenger and Instagram, resolve display_name via Graph API; for WhatsApp use profileName as-is
  const displayName = (channel === 'messenger' || channel === 'instagram')
    ? await resolveGraphAPIDisplayName(waId, pageAccessToken, socialContactsCache)
    : (profileName || waId);

  const conn = await pool.getConnection();
  try {
    // Step 1: find existing conversation
    const [rows] = await conn.execute<ConversationRow[]>(
      'SELECT id FROM meta_conversations WHERE external_thread_id = ? AND channel = ? AND deleted = 0 LIMIT 1',
      [waId, channel],
    );

    let conversationId: string;

    if (rows.length > 0) {
      conversationId = rows[0]!.id;
    } else {
      // Step 2: create new conversation
      conversationId = randomUUID();
      const now = new Date();
      await conn.execute(
        `INSERT INTO meta_conversations
          (id, channel, channel_id, external_thread_id, contact_id, display_name, status, unread_count, date_entered, date_modified, deleted)
         VALUES (?, ?, ?, ?, ?, ?, 'open', 1, ?, ?, 0)`,
        [
          conversationId,
          channel,
          phoneNumberId,
          waId,
          contactIdSuitecrm ?? '',
          displayName,
          now,
          now,
        ],
      );
      logger.info({ conversationId, waId, channel }, 'suitecrm-sync: created meta_conversation');
    }

    // Step 3: create message
    const messageId = randomUUID();
    const sentAt = new Date(timestamp * 1000);
    const now = new Date();
    await conn.execute(
      `INSERT INTO meta_messages
        (id, conversation_id, external_message_id, direction, message_type, body, sent_at, raw_payload, date_entered, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        messageId,
        conversationId,
        wamid,
        direction,
        messageType,
        body ?? '',
        sentAt,
        JSON.stringify({ wamid, waId, body, timestamp, messageType }),
        now,
      ],
    );
    logger.info({ messageId, conversationId, wamid }, 'suitecrm-sync: created meta_message');

    // Step 4: update conversation last_message info
    const preview = body ? body.slice(0, 100) : `[${messageType}]`;
    await conn.execute(
      `UPDATE meta_conversations
         SET last_message_preview = ?,
             last_message_at = NOW(),
             unread_count = unread_count + 1,
             date_modified = NOW()
       WHERE id = ?`,
      [preview, conversationId],
    );

    // Step 5: set contact_id if provided and conversation didn't have one
    if (contactIdSuitecrm && rows.length > 0) {
      const [existing] = await conn.execute<ContactRow[]>(
        'SELECT contact_id FROM meta_conversations WHERE id = ? LIMIT 1',
        [conversationId],
      );
      if (existing.length > 0 && !existing[0]!.contact_id) {
        await conn.execute(
          'UPDATE meta_conversations SET contact_id = ?, date_modified = NOW() WHERE id = ?',
          [contactIdSuitecrm, conversationId],
        );
      }
    }
  } finally {
    conn.release();
  }
}
