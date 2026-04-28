import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import nock from 'nock';
import {
  SuiteCrmClient,
  SuiteCrmApiError,
} from '../src/services/suitecrm.js';

const BASE = 'https://test.suitecrm.local';
const CLIENT_ID = 'test-client';
const CLIENT_SECRET = 'test-secret';

function tokenScope(token = 'jwt-token-aaa', expiresIn = 3600): nock.Scope {
  return nock(BASE)
    .post('/legacy/Api/access_token', (body: Record<string, unknown>) =>
      body.grant_type === 'client_credentials' &&
      body.client_id === CLIENT_ID &&
      body.client_secret === CLIENT_SECRET,
    )
    .reply(200, { token_type: 'Bearer', expires_in: expiresIn, access_token: token });
}

beforeAll(() => {
  nock.disableNetConnect();
});

afterAll(() => {
  nock.enableNetConnect();
});

afterEach(() => {
  nock.cleanAll();
});

describe('SuiteCrmClient.getAccessToken', () => {
  it('parses access_token, caches it, and reuses while still valid', async () => {
    tokenScope('jwt-aaa', 3600);
    const client = new SuiteCrmClient(BASE, CLIENT_ID, CLIENT_SECRET);

    const token = await client.getAccessToken();
    expect(token).toBe('jwt-aaa');

    // Second call must come from the in-memory cache; if it hits the network
    // nock would error because we already consumed the only interceptor.
    const again = await client.getAccessToken();
    expect(again).toBe('jwt-aaa');
  });

  it('throws SuiteCrmApiError when the token endpoint returns non-2xx', async () => {
    nock(BASE).post('/legacy/Api/access_token').reply(401, { error: 'invalid_client' });
    const client = new SuiteCrmClient(BASE, CLIENT_ID, CLIENT_SECRET);
    await expect(client.getAccessToken()).rejects.toBeInstanceOf(SuiteCrmApiError);
  });
});

describe('SuiteCrmClient.findContactByPhone', () => {
  it('returns null when the API responds with an empty data array', async () => {
    tokenScope();
    nock(BASE)
      .get('/legacy/Api/V8/module/Contacts')
      .query(true)
      .reply(200, { data: [] });

    const client = new SuiteCrmClient(BASE, CLIENT_ID, CLIENT_SECRET);
    const result = await client.findContactByPhone('+5491134567890');
    expect(result).toBeNull();
  });

  it('returns the mapped contact when one is found, stripping the leading +', async () => {
    tokenScope();
    nock(BASE)
      .get('/legacy/Api/V8/module/Contacts')
      .query((q: Record<string, string>) => q['filter[phone_mobile][eq]'] === '5491134567890')
      .matchHeader('accept', 'application/vnd.api+json')
      .matchHeader('authorization', /^Bearer .+/)
      .reply(200, {
        data: [
          {
            id: 'contact-1',
            type: 'Contacts',
            attributes: {
              first_name: 'Juan',
              last_name: 'Pérez',
              name: 'Juan Pérez',
              phone_mobile: '5491134567890',
              phone_work: '',
              email1: 'juan@example.com',
            },
          },
        ],
      });

    const client = new SuiteCrmClient(BASE, CLIENT_ID, CLIENT_SECRET);
    const contact = await client.findContactByPhone('+5491134567890');
    expect(contact).not.toBeNull();
    expect(contact?.id).toBe('contact-1');
    expect(contact?.firstName).toBe('Juan');
    expect(contact?.lastName).toBe('Pérez');
    expect(contact?.phoneMobile).toBe('5491134567890');
    expect(contact?.email).toBe('juan@example.com');
  });
});

describe('SuiteCrmClient.createLead', () => {
  it('POSTs JSON:API body with expected attributes', async () => {
    tokenScope();
    let observedBody: unknown = null;
    nock(BASE)
      .post('/legacy/Api/V8/module', (body: unknown) => {
        observedBody = body;
        return true;
      })
      .matchHeader('content-type', 'application/vnd.api+json')
      .reply(201, {
        data: {
          id: 'lead-1',
          type: 'Leads',
          attributes: {
            first_name: 'Ana',
            last_name: 'García',
            name: 'Ana García',
            phone_mobile: '5491198765432',
            lead_source: 'whatsapp',
          },
        },
      });

    const client = new SuiteCrmClient(BASE, CLIENT_ID, CLIENT_SECRET);
    const lead = await client.createLead({
      firstName: 'Ana',
      lastName: 'García',
      phoneE164: '+5491198765432',
      source: 'whatsapp',
    });

    expect(lead.id).toBe('lead-1');
    expect(lead.firstName).toBe('Ana');
    expect(lead.leadSource).toBe('whatsapp');
    expect(observedBody).toEqual({
      data: {
        type: 'Leads',
        attributes: {
          first_name: 'Ana',
          last_name: 'García',
          phone_mobile: '5491198765432',
          lead_source: 'whatsapp',
        },
      },
    });
  });
});

describe('SuiteCrmClient.appendNote', () => {
  it('POSTs a Note with parent_type + parent_id and truncates name when long', async () => {
    tokenScope();
    let observedBody: unknown = null;
    nock(BASE)
      .post('/legacy/Api/V8/module', (body: unknown) => {
        observedBody = body;
        return true;
      })
      .reply(201, {
        data: {
          id: 'note-1',
          type: 'Notes',
          attributes: {
            name: 'truncated name',
            description: 'long body content longer than 50 characters in total length here',
          },
        },
      });

    const client = new SuiteCrmClient(BASE, CLIENT_ID, CLIENT_SECRET);
    const longBody = 'long body content longer than 50 characters in total length here';
    const note = await client.appendNote('Contacts', 'contact-1', longBody);

    expect(note.id).toBe('note-1');
    expect(note.parentType).toBe('Contacts');
    expect(note.parentId).toBe('contact-1');

    const sent = observedBody as {
      data: { type: string; attributes: { name: string; description: string; parent_type: string; parent_id: string } };
    };
    expect(sent.data.type).toBe('Notes');
    expect(sent.data.attributes.parent_type).toBe('Contacts');
    expect(sent.data.attributes.parent_id).toBe('contact-1');
    expect(sent.data.attributes.description).toBe(longBody);
    expect(sent.data.attributes.name.length).toBeLessThanOrEqual(50);
    expect(sent.data.attributes.name.endsWith('...')).toBe(true);
  });
});

describe('SuiteCrmClient 401 handling', () => {
  it('forces a token refresh and retries the request once on 401', async () => {
    tokenScope('jwt-old', 3600);

    nock(BASE)
      .get('/legacy/Api/V8/module/Contacts')
      .query(true)
      .matchHeader('authorization', 'Bearer jwt-old')
      .reply(401, { error: 'invalid_token' });

    tokenScope('jwt-new', 3600);

    nock(BASE)
      .get('/legacy/Api/V8/module/Contacts')
      .query(true)
      .matchHeader('authorization', 'Bearer jwt-new')
      .reply(200, { data: [] });

    const client = new SuiteCrmClient(BASE, CLIENT_ID, CLIENT_SECRET);
    const result = await client.findContactByPhone('+12025550100');
    expect(result).toBeNull();
    expect(nock.isDone()).toBe(true);
  });
});

describe('SuiteCrmClient error propagation', () => {
  it('throws SuiteCrmApiError with status + body on 5xx', async () => {
    tokenScope();
    nock(BASE)
      .get('/legacy/Api/V8/module/Contacts')
      .query(true)
      .reply(500, { errors: [{ title: 'boom' }] });

    const client = new SuiteCrmClient(BASE, CLIENT_ID, CLIENT_SECRET);
    try {
      await client.findContactByPhone('+12025550100');
      throw new Error('expected SuiteCrmApiError');
    } catch (err) {
      expect(err).toBeInstanceOf(SuiteCrmApiError);
      const apiErr = err as SuiteCrmApiError;
      expect(apiErr.status).toBe(500);
      expect(apiErr.body).toEqual({ errors: [{ title: 'boom' }] });
    }
  });

  it('does not loop on repeated 5xx — bubbles up after the first failure', async () => {
    tokenScope();
    const scope = nock(BASE)
      .get('/legacy/Api/V8/module/Contacts')
      .query(true)
      .reply(503, { errors: [{ title: 'unavailable' }] });

    const client = new SuiteCrmClient(BASE, CLIENT_ID, CLIENT_SECRET);
    await expect(client.findContactByPhone('+12025550100')).rejects.toBeInstanceOf(SuiteCrmApiError);
    expect(scope.isDone()).toBe(true);
    // No remaining interceptors means the client did not silently retry 5xx.
    expect(nock.pendingMocks()).toEqual([]);
  });
});

describe('SuiteCrmClient 429 backoff + retry', () => {
  it('retries once after 429 with Retry-After honored and succeeds', async () => {
    tokenScope();

    nock(BASE)
      .get('/legacy/Api/V8/module/Contacts')
      .query(true)
      .reply(429, { error: 'rate_limited' }, { 'Retry-After': '0' });

    nock(BASE)
      .get('/legacy/Api/V8/module/Contacts')
      .query(true)
      .reply(200, { data: [] });

    const client = new SuiteCrmClient(BASE, CLIENT_ID, CLIENT_SECRET);
    const start = Date.now();
    const result = await client.findContactByPhone('+12025550100');
    const elapsed = Date.now() - start;
    expect(result).toBeNull();
    // Retry-After: 0 means we should not wait the default 1s.
    expect(elapsed).toBeLessThan(900);
    expect(nock.isDone()).toBe(true);
  });

  it('throws SuiteCrmApiError if 429 persists after one retry (no infinite loop)', async () => {
    tokenScope();

    nock(BASE)
      .get('/legacy/Api/V8/module/Contacts')
      .query(true)
      .reply(429, { error: 'rate_limited' }, { 'Retry-After': '0' });

    nock(BASE)
      .get('/legacy/Api/V8/module/Contacts')
      .query(true)
      .reply(429, { error: 'still_rate_limited' }, { 'Retry-After': '0' });

    const client = new SuiteCrmClient(BASE, CLIENT_ID, CLIENT_SECRET);
    try {
      await client.findContactByPhone('+12025550100');
      throw new Error('expected SuiteCrmApiError');
    } catch (err) {
      expect(err).toBeInstanceOf(SuiteCrmApiError);
      expect((err as SuiteCrmApiError).status).toBe(429);
    }
    expect(nock.isDone()).toBe(true);
    // No further requests issued — confirms exactly one retry.
    expect(nock.pendingMocks()).toEqual([]);
  });
});

describe('SuiteCrmClient token expiry', () => {
  it('refreshes the cached token after it expires', async () => {
    // Token expires almost immediately so the leeway check forces a refresh.
    tokenScope('jwt-1', 1);
    nock(BASE)
      .get('/legacy/Api/V8/module/Contacts')
      .query(true)
      .matchHeader('authorization', 'Bearer jwt-1')
      .reply(200, { data: [] });

    const client = new SuiteCrmClient(BASE, CLIENT_ID, CLIENT_SECRET);
    const first = await client.findContactByPhone('+12025550100');
    expect(first).toBeNull();

    // Second call: leeway will treat the cached token as expired, so the
    // client must call /access_token again before the GET.
    tokenScope('jwt-2', 3600);
    nock(BASE)
      .get('/legacy/Api/V8/module/Contacts')
      .query(true)
      .matchHeader('authorization', 'Bearer jwt-2')
      .reply(200, { data: [] });

    const second = await client.findContactByPhone('+12025550100');
    expect(second).toBeNull();
    expect(nock.isDone()).toBe(true);
  });
});
