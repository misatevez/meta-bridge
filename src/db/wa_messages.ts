import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

// Valid message status progression — forward only
const STATUS_ORDER = ['sent', 'delivered', 'read'] as const;
type KnownStatus = (typeof STATUS_ORDER)[number];

function isValidStatusTransition(from: string | null, to: string): boolean {
  const fromIdx = from === null ? -1 : STATUS_ORDER.indexOf(from as KnownStatus);
  const toIdx = STATUS_ORDER.indexOf(to as KnownStatus);
  // Unknown statuses (e.g. 'failed', 'error') are allowed to pass through
  if (toIdx === -1) return true;
  // Must advance forward in the order; null means no prior status
  return toIdx > fromIdx;
}

export interface IncomingMessage {
  wamid: string;
  waId: string;
  channel?: 'whatsapp' | 'messenger' | 'instagram';
  senderPsid?: string | null;
  body: string | null;
  raw: unknown;
}

export interface MessageStatusRow {
  wamid: string;
  status: string | null;
  direction: string;
  created_at: Date;
}

export interface MessageStore {
  insertIncomingMessage(msg: IncomingMessage): Promise<{ inserted: boolean }>;
  updateContactId(wamid: string, contactId: string): Promise<void>;
  updateMessageStatus(wamid: string, status: string): Promise<{ updated: boolean }>;
  getMessageStatuses(waId: string): Promise<MessageStatusRow[]>;
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
    async updateMessageStatus(wamid, status) {
      const [rows] = await pool.query<(RowDataPacket & { status: string | null })[]>(
        'SELECT `status` FROM `wa_messages` WHERE `wamid` = ? LIMIT 1',
        [wamid],
      );
      if (rows.length === 0) {
        return { updated: false };
      }
      const currentStatus = rows[0].status;
      if (!isValidStatusTransition(currentStatus, status)) {
        throw new Error(`Invalid status transition: ${currentStatus} → ${status}`);
      }
      const [result] = await pool.execute<ResultSetHeader>(
        'UPDATE `wa_messages` SET `status` = ? WHERE `wamid` = ?',
        [status, wamid],
      );
      return { updated: result.affectedRows > 0 };
    },
    async getMessageStatuses(waId) {
      const [rows] = await pool.query<(MessageStatusRow & RowDataPacket)[]>(
        'SELECT `wamid`, `status`, `direction`, `created_at` FROM `wa_messages` WHERE `wa_id` = ? ORDER BY `created_at` ASC',
        [waId],
      );
      return rows;
    },
  };
}
