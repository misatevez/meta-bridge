import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phoneMobile: string;
  phoneWork: string;
  email: string;
}

export interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phoneMobile: string;
  leadSource: string;
}

export type ParentType = 'Contacts' | 'Leads';

export interface Note {
  id: string;
  name: string;
  description: string;
  parentType: ParentType;
  parentId: string;
}

export interface CreateLeadInput {
  firstName: string;
  lastName: string;
  phoneE164: string;
  source: string;
}

export interface CreateContactInput {
  firstName: string;
  phoneMobile?: string;
  description?: string;
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export class SuiteCrmApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message?: string,
  ) {
    super(message ?? `SuiteCRM API error ${status}`);
    this.name = 'SuiteCrmApiError';
  }
}

interface JsonApiResource<TAttrs = Record<string, unknown>> {
  id: string;
  type: string;
  attributes: TAttrs;
}

interface JsonApiCollectionResponse<TAttrs = Record<string, unknown>> {
  data: Array<JsonApiResource<TAttrs>>;
  meta?: Record<string, unknown>;
}

interface JsonApiSingleResponse<TAttrs = Record<string, unknown>> {
  data: JsonApiResource<TAttrs>;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

const REFRESH_LEEWAY_MS = 60_000;
const TOKEN_PATH = '/legacy/Api/access_token';
const MODULE_PATH = '/legacy/Api/V8/module';
const DEFAULT_429_BACKOFF_MS = 1_000;
const MAX_429_BACKOFF_MS = 30_000;

function parseRetryAfterMs(header: unknown): number | null {
  if (typeof header !== 'string' || header.length === 0) return null;
  const trimmed = header.trim();
  const seconds = Number.parseInt(trimmed, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_429_BACKOFF_MS);
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isFinite(dateMs)) return null;
  const delta = dateMs - Date.now();
  return delta > 0 ? Math.min(delta, MAX_429_BACKOFF_MS) : 0;
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export class SuiteCrmClient {
  private readonly http: AxiosInstance;
  private cached: CachedToken | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {
    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 15_000,
      validateStatus: () => true,
    });
  }

  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt - now > REFRESH_LEEWAY_MS) {
      return this.cached.token;
    }

    const res = await this.http.post(
      TOKEN_PATH,
      {
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: '',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      },
    );

    if (res.status < 200 || res.status >= 300) {
      throw new SuiteCrmApiError(res.status, res.data, 'failed to obtain access token');
    }

    const body = res.data as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') {
      throw new SuiteCrmApiError(res.status, res.data, 'invalid token response shape');
    }

    this.cached = {
      token: body.access_token,
      expiresAt: now + body.expires_in * 1000,
    };
    return this.cached.token;
  }

  async request<T = unknown>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    const send = async (token: string) => {
      const cfg: AxiosRequestConfig = {
        method,
        url: path,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.api+json',
        },
      };
      if (body !== undefined) {
        cfg.data = body;
        cfg.headers = { ...cfg.headers, 'Content-Type': 'application/vnd.api+json' };
      }
      return this.http.request(cfg);
    };

    let token = await this.getAccessToken();
    let res = await send(token);

    if (res.status === 401) {
      this.cached = null;
      token = await this.getAccessToken();
      res = await send(token);
    }

    if (res.status === 429) {
      const retryAfter = parseRetryAfterMs(res.headers?.['retry-after']);
      const waitMs = retryAfter ?? DEFAULT_429_BACKOFF_MS;
      await delay(waitMs);
      res = await send(token);
    }

    if (res.status < 200 || res.status >= 300) {
      throw new SuiteCrmApiError(res.status, res.data);
    }

    return res.data as T;
  }

  async findContactByPhone(e164: string): Promise<Contact | null> {
    return this.findContactByPhoneField('phone_mobile', e164);
  }

  async findContactByPhoneField(field: string, phone: string): Promise<Contact | null> {
    const normalized = stripPlus(phone);
    const params = new URLSearchParams();
    params.set(`filter[${field}][eq]`, normalized);
    params.set('fields[Contacts]', 'first_name,last_name,phone_mobile,phone_work,email1,name');
    params.set('page[size]', '1');

    const res = await this.request<JsonApiCollectionResponse>(
      'GET',
      `${MODULE_PATH}/Contacts?${params.toString()}`,
    );

    const first = res.data?.[0];
    if (!first) return null;
    return mapContact(first);
  }

  async createContact(input: CreateContactInput): Promise<Contact> {
    const attrs: Record<string, string> = {
      first_name: input.firstName,
      last_name: '',
    };
    if (input.phoneMobile) attrs.phone_mobile = input.phoneMobile;
    if (input.description) attrs.description = input.description;

    const body = {
      data: {
        type: 'Contacts',
        attributes: attrs,
      },
    };

    const res = await this.request<JsonApiSingleResponse>('POST', MODULE_PATH, body);
    return mapContact(res.data);
  }

  async createLead(input: CreateLeadInput): Promise<Lead> {
    const body = {
      data: {
        type: 'Leads',
        attributes: {
          first_name: input.firstName,
          last_name: input.lastName,
          phone_mobile: stripPlus(input.phoneE164),
          lead_source: input.source,
        },
      },
    };

    const res = await this.request<JsonApiSingleResponse>('POST', MODULE_PATH, body);
    return mapLead(res.data);
  }

  async appendNote(parentType: ParentType, parentId: string, body: string): Promise<Note> {
    const name = body.length > 50 ? `${body.slice(0, 47)}...` : body;
    const reqBody = {
      data: {
        type: 'Notes',
        attributes: {
          name,
          description: body,
          parent_type: parentType,
          parent_id: parentId,
        },
      },
    };

    const res = await this.request<JsonApiSingleResponse>('POST', MODULE_PATH, reqBody);
    return mapNote(res.data, parentType, parentId);
  }
}

function stripPlus(phone: string): string {
  return phone.startsWith('+') ? phone.slice(1) : phone;
}

function getStr(attrs: Record<string, unknown> | undefined, key: string): string {
  if (!attrs) return '';
  const v = attrs[key];
  return typeof v === 'string' ? v : '';
}

function mapContact(r: JsonApiResource): Contact {
  return {
    id: r.id,
    firstName: getStr(r.attributes, 'first_name'),
    lastName: getStr(r.attributes, 'last_name'),
    fullName: getStr(r.attributes, 'name'),
    phoneMobile: getStr(r.attributes, 'phone_mobile'),
    phoneWork: getStr(r.attributes, 'phone_work'),
    email: getStr(r.attributes, 'email1'),
  };
}

function mapLead(r: JsonApiResource): Lead {
  return {
    id: r.id,
    firstName: getStr(r.attributes, 'first_name'),
    lastName: getStr(r.attributes, 'last_name'),
    fullName: getStr(r.attributes, 'name'),
    phoneMobile: getStr(r.attributes, 'phone_mobile'),
    leadSource: getStr(r.attributes, 'lead_source'),
  };
}

function mapNote(r: JsonApiResource, parentType: ParentType, parentId: string): Note {
  return {
    id: r.id,
    name: getStr(r.attributes, 'name'),
    description: getStr(r.attributes, 'description'),
    parentType,
    parentId,
  };
}
