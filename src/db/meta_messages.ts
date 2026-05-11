import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

export interface MetaMessageData {
  wamid: string;
  conversationId: number;
  direction: 'in' | 'out';
  channel: 'whatsapp' | 'messenger' | 'instagram';
  senderPsid?: string | null;
  body: string | null;
  rawPayload: unknown;
}

export interface MediaUpdate {
  mediaUrl: string;
  mediaType: string;
  mediaFilename?: string | null;
}

interface ConversationRow extends RowDataPacket {
  id: number;
}

interface MsgIdRow extends RowDataPacket {
  id: number;
}

interface MediaRow extends RowDataPacket {
  media_url: string;
  media_type: string;
  media_filename: string | null;
}

export interface MetaMessageStore {
  findOrCreateConversation(
    waId: string,
    channel: 'whatsapp' | 'messenger' | 'instagram',
    senderPsid?: string | null,
  ): Promise<number>;
  insertMessage(data: MetaMessageData): Promise<{ id: number; inserted: boolean }>;
  updateMedia(wamid: string, media: MediaUpdate): Promise<void>;
  getMediaById(id: number): Promise<{ mediaUrl: string; mediaType: string; mediaFilename: string | null } | null>;
}

export function createMetaMessageStore(pool: Pool): MetaMessageStore {
  return {
    async findOrCreateConversation(waId, channel, senderPsid) {
      const [rows] = await pool.execute<ConversationRow[]>(
        'SELECT id FROM meta_conversations WHERE wa_id = ? AND channel = ? LIMIT 1',
        [waId, channel],
      );
      if (rows.length > 0) {
        const id = rows[0]!.id;
        await pool.execute('UPDATE meta_conversations SET last_message_at = NOW() WHERE id = ?', [id]);
        return id;
      }
      const [result] = await pool.execute<ResultSetHeader>(
        'INSERT INTO meta_conversations (wa_id, channel, sender_psid, last_message_at) VALUES (?, ?, ?, NOW())',
        [waId, channel, senderPsid ?? null],
      );
      return result.insertId;
    },

    async insertMessage(data) {
      const [result] = await pool.execute<ResultSetHeader>(
        `INSERT IGNORE INTO meta_messages
          (conversation_id, wamid, direction, channel, sender_psid, body, raw_payload)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          data.conversationId,
          data.wamid,
          data.direction,
          data.channel,
          data.senderPsid ?? null,
          data.body,
          JSON.stringify(data.rawPayload),
        ],
      );
      if (result.affectedRows > 0) return { id: result.insertId, inserted: true };
      const [rows] = await pool.execute<MsgIdRow[]>(
        'SELECT id FROM meta_messages WHERE wamid = ? LIMIT 1',
        [data.wamid],
      );
      return { id: rows.length > 0 ? rows[0]!.id : 0, inserted: false };
    },

    async updateMedia(wamid, media) {
      await pool.execute(
        'UPDATE meta_messages SET media_url = ?, media_type = ?, media_filename = ? WHERE wamid = ?',
        [media.mediaUrl, media.mediaType, media.mediaFilename ?? null, wamid],
      );
    },

    async getMediaById(id) {
      const [rows] = await pool.execute<MediaRow[]>(
        'SELECT media_url, media_type, media_filename FROM meta_messages WHERE id = ? AND media_url IS NOT NULL LIMIT 1',
        [id],
      );
      if (rows.length === 0) return null;
      const row = rows[0]!;
      return { mediaUrl: row.media_url, mediaType: row.media_type, mediaFilename: row.media_filename };
    },
  };
}
