import type { Pool } from 'mysql2/promise';

export interface MessengerContactMap {
  id: number;
  psid: string;
  contact_id_suitecrm: string | null;
  display_name: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface MessengerContactStore {
  resolve(psid: string): Promise<string | null>;
  upsert(psid: string, contactId: string | null, displayName: string | null): Promise<void>;
  getByPsid(psid: string): Promise<MessengerContactMap | null>;
}

export function createMessengerContactStore(pool: Pool): MessengerContactStore {
  return {
    async resolve(psid) {
      const [rows] = await pool.execute<any[]>(
        'SELECT `contact_id_suitecrm` FROM `messenger_contacts_map` WHERE `psid` = ?',
        [psid],
      );
      if (rows.length === 0) return null;
      return rows[0].contact_id_suitecrm;
    },
    async upsert(psid, contactId, displayName) {
      await pool.execute(
        'INSERT INTO `messenger_contacts_map` (`psid`, `contact_id_suitecrm`, `display_name`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `contact_id_suitecrm` = ?, `display_name` = ?, `updated_at` = CURRENT_TIMESTAMP',
        [psid, contactId, displayName, contactId, displayName],
      );
    },
    async getByPsid(psid) {
      const [rows] = await pool.execute<any[]>(
        'SELECT * FROM `messenger_contacts_map` WHERE `psid` = ?',
        [psid],
      );
      if (rows.length === 0) return null;
      return rows[0] as MessengerContactMap;
    },
  };
}
