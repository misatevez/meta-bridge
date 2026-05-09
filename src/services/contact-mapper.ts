import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { CreateContactInput, SuiteCrmClient } from './suitecrm.js';
import { logger } from '../logger.js';

const PHONE_FIELDS = ['phone_mobile', 'phone_work', 'phone_home', 'phone_other'] as const;

export interface ResolveOptions {
  profileName?: string;
  channel?: 'whatsapp' | 'messenger' | 'instagram';
}

export class ContactMapper {
  constructor(
    private readonly pool: Pool,
    private readonly suitecrm: SuiteCrmClient,
  ) {}

  async resolve(waId: string, options?: ResolveOptions): Promise<string | null> {
    try {
      const cached = await this.getFromCache(waId);
      if (cached !== null) {
        logger.debug({ waId, contactId: cached }, 'contact-mapper: cache hit');
        return cached;
      }

      // Only search by phone for WhatsApp (psid/igsid are not phone numbers)
      const channel = options?.channel ?? 'whatsapp';
      let contactId: string | null = null;
      if (channel === 'whatsapp') {
        contactId = await this.searchSuiteCrm(waId);
        if (contactId !== null) {
          await this.saveToCache(waId, contactId);
          logger.info({ waId, contactId }, 'contact-mapper: contact found and cached');
          return contactId;
        }
      }

      if (options !== undefined) {
        contactId = await this.autoCreateContact(waId, options);
        if (contactId !== null) {
          await this.saveToCache(waId, contactId);
        }
      } else {
        logger.info({ waId }, 'contact-mapper: no contact found');
      }
      return contactId;
    } catch (err) {
      logger.warn({ err, waId }, 'contact-mapper: error resolving contact, continuing');
      return null;
    }
  }

  private async autoCreateContact(waId: string, options: ResolveOptions): Promise<string | null> {
    try {
      const channel = options.channel ?? 'whatsapp';
      const profileName = options.profileName && options.profileName !== waId ? options.profileName : waId;
      const date = new Date().toISOString().split('T')[0];
      const description = `Auto-creado desde ${channel} el ${date}`;

      const input: CreateContactInput = {
        firstName: profileName,
        description,
      };

      if (channel === 'whatsapp') {
        input.phoneMobile = waId.startsWith('+') ? waId.slice(1) : waId;
      }

      const contact = await this.suitecrm.createContact(input);
      logger.info({ waId, contactId: contact.id, channel }, 'contact-mapper: auto-created contact in SuiteCRM');
      return contact.id;
    } catch (err) {
      logger.warn({ err, waId }, 'contact-mapper: failed to auto-create contact, continuing without');
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
