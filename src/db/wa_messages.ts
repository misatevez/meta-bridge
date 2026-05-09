import type { Pool, ResultSetHeader } from 'mysql2/promise';

export interface IncomingMessage {
  wamid: string;
  waId: string;
  channel?: 'whatsapp' | 'messenger' | 'instagram';
  senderPsid?: string | null;
  body: string | null;
  raw: unknown;
}

export interface MessageStore {
  insertIncomingMessage(msg: IncomingMessage): Promise<{ inserted: boolean }>;
  updateContactId(wamid: string, contactId: string): Promise<void>;
}

export function createMessageStore(pool: Pool): MessageStore {
  return {
    async insertIncomingMessage(msg) {
      const [result] = await pool.execute<ResultSetHeader>(
        'INSERT IGNORE INTO `wa_messages` (`wamid`, `direction`, `wa_id`, `channel`, `sender_psid`, `body`, `raw_payload`) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [msg.wamid, 'in', msg.waId, msg.channel || 'whatsapp', msg.senderPsid || null, msg.body, JSON.stringify(msg.raw)],
      );
      return { inserted: result.affectedRows > 0 };
    },
    async updateContactId(wamid, contactId) {
      await pool.execute(
        'UPDATE `wa_messages` SET `contact_id_suitecrm` = ? WHERE `wamid` = ?',
        [contactId, wamid],
      );
    },
  };
}
