import type { Pool, ResultSetHeader } from 'mysql2/promise';

export interface IncomingMessage {
  wamid: string;
  waId: string;
  body: string | null;
  raw: unknown;
}

export interface MessageStore {
  insertIncomingMessage(msg: IncomingMessage): Promise<{ inserted: boolean }>;
}

export function createMessageStore(pool: Pool): MessageStore {
  return {
    async insertIncomingMessage(msg) {
      const [result] = await pool.execute<ResultSetHeader>(
        'INSERT IGNORE INTO `wa_messages` (`wamid`, `direction`, `wa_id`, `body`, `raw_payload`) VALUES (?, ?, ?, ?, ?)',
        [msg.wamid, 'in', msg.waId, msg.body, JSON.stringify(msg.raw)],
      );
      return { inserted: result.affectedRows > 0 };
    },
  };
}
