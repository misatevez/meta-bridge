import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { SuiteCrmClient } from './suitecrm.js';
import { logger } from '../logger.js';

const PHONE_FIELDS = ['phone_mobile', 'phone_work', 'phone_home', 'phone_other'] as const;

export class ContactMapper {
  constructor(
    private readonly pool: Pool,
    private readonly suitecrm: SuiteCrmClient,
  ) {}

  async resolve(waId: string): Promise<string | null> {
    try {
      const cached = await this.getFromCache(waId);
      if (cached !== null) {
        logger.debug({ waId, contactId: cached }, 'contact-mapper: cache hit');
        return cached;
      }

      const contactId = await this.searchSuiteCrm(waId);
      if (contactId !== null) {
        await this.saveToCache(waId, contactId);
        logger.info({ waId, contactId }, 'contact-mapper: contact found and cached');
      } else {
        logger.info({ waId }, 'contact-mapper: no contact found');
      }
      return contactId;
    } catch (err) {
      logger.warn({ err, waId }, 'contact-mapper: error resolving contact, continuing');
      return null;
    }
  }

  private async getFromCache(waId: string): Promise<string | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT contact_id_suitecrm FROM wa_contacts_map WHERE wa_id = ?',
      [waId],
    );
    const first = rows[0];
    return first !== undefined ? (first.contact_id_suitecrm as string) : null;
  }

  private async searchSuiteCrm(waId: string): Promise<string | null> {
    const variants = getPhoneVariants(waId);
    for (const field of PHONE_FIELDS) {
      for (const phone of variants) {
        const contact = await this.suitecrm.findContactByPhoneField(field, phone);
        if (contact !== null) return contact.id;
      }
    }
    return null;
  }

  private async saveToCache(waId: string, contactId: string): Promise<void> {
    await this.pool.execute(
      'INSERT IGNORE INTO wa_contacts_map (wa_id, contact_id_suitecrm) VALUES (?, ?)',
      [waId, contactId],
    );
  }
}

function getPhoneVariants(waId: string): string[] {
  const stripped = waId.startsWith('+') ? waId.slice(1) : waId;
  return [stripped, `+${stripped}`];
}
