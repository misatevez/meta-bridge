import axios from 'axios';

const META_GRAPH_BASE = 'https://graph.facebook.com/v19.0';

export interface WaTemplateComponent {
  type: string;
  text?: string;
  parameters?: Array<{ type: string; text?: string }>;
}

export interface WaTemplate {
  name: string;
  language: string;
  status: string;
  category?: string;
  components: WaTemplateComponent[];
}

export interface SendMessageInput {
  to: string;
  templateName: string;
  language: string;
  variables: string[];
  contactId?: string;
  accountId?: string;
}

export interface SendMessageResult {
  wamid: string;
  status: 'pending';
}

export interface SendTemplateRawInput {
  to: string;
  templateName: string;
  language: string;
  components: unknown[];
}

export async function fetchTemplates(wabaId: string, accessToken: string): Promise<WaTemplate[]> {
  const res = await axios.get<{ data?: unknown[] }>(
    `${META_GRAPH_BASE}/${wabaId}/message_templates`,
    {
      params: {
        access_token: accessToken,
        fields: 'name,language,status,components,category',
        limit: 200,
      },
      timeout: 10_000,
      validateStatus: () => true,
    },
  );

  if (res.status !== 200) {
    throw new Error(`Meta Graph API error ${res.status}: ${JSON.stringify(res.data)}`);
  }

  return (res.data.data ?? []) as WaTemplate[];
}

export async function sendTemplateMessage(
  phoneNumberId: string,
  accessToken: string,
  input: SendMessageInput,
): Promise<SendMessageResult> {
  const body = {
    messaging_product: 'whatsapp',
    to: input.to,
    type: 'template',
    template: {
      name: input.templateName,
      language: { code: input.language },
      components:
        input.variables.length > 0
          ? [
              {
                type: 'body',
                parameters: input.variables.map((v) => ({ type: 'text', text: v })),
              },
            ]
          : [],
    },
  };

  const res = await axios.post<{ messages?: Array<{ id?: string }> }>(
    `${META_GRAPH_BASE}/${phoneNumberId}/messages`,
    body,
    {
      params: { access_token: accessToken },
      timeout: 15_000,
      validateStatus: () => true,
    },
  );

  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `Meta messages API error ${res.status}: ${JSON.stringify(res.data)}`,
    );
  }

  const wamid = res.data.messages?.[0]?.id ?? `local-${Date.now()}`;
  return { wamid, status: 'pending' };
}

export async function sendTextMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  text: string,
): Promise<{ wamid: string }> {
  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  };

  const res = await axios.post<{ messages?: Array<{ id?: string }> }>(
    `${META_GRAPH_BASE}/${phoneNumberId}/messages`,
    body,
    {
      params: { access_token: accessToken },
      timeout: 15_000,
      validateStatus: () => true,
    },
  );

  if (res.status < 200 || res.status >= 300) {
    const data = res.data as { error?: { code?: number; message?: string } };
    if (data?.error?.code === 131047 || data?.error?.code === 130472) {
      throw Object.assign(new Error('outside_24h_window'), { code: 'outside_24h_window' });
    }
    throw new Error(`Meta messages API error ${res.status}: ${JSON.stringify(res.data)}`);
  }

  const wamid = res.data.messages?.[0]?.id ?? `local-${Date.now()}`;
  return { wamid };
}

export interface CreateTemplateInput {
  name: string;
  language: string;
  category: string;
  components: WaTemplateComponent[];
}

export interface CreateTemplateResult {
  id: string;
}

export async function createTemplate(
  wabaId: string,
  accessToken: string,
  input: CreateTemplateInput,
): Promise<CreateTemplateResult> {
  const res = await axios.post<{ id?: string }>(
    `${META_GRAPH_BASE}/${wabaId}/message_templates`,
    {
      name: input.name,
      language: input.language,
      category: input.category,
      components: input.components,
    },
    {
      params: { access_token: accessToken },
      timeout: 15_000,
      validateStatus: () => true,
    },
  );

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Meta templates API error ${res.status}: ${JSON.stringify(res.data)}`);
  }

  return { id: res.data.id ?? '' };
}

export async function deleteTemplate(
  wabaId: string,
  accessToken: string,
  name: string,
): Promise<void> {
  const res = await axios.delete<unknown>(
    `${META_GRAPH_BASE}/${wabaId}/message_templates`,
    {
      params: { access_token: accessToken, name },
      timeout: 15_000,
      validateStatus: () => true,
    },
  );

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Meta templates API error ${res.status}: ${JSON.stringify(res.data)}`);
  }
}

export async function sendTemplateRaw(
  phoneNumberId: string,
  accessToken: string,
  input: SendTemplateRawInput,
): Promise<SendMessageResult> {
  const body = {
    messaging_product: 'whatsapp',
    to: input.to,
    type: 'template',
    template: {
      name: input.templateName,
      language: { code: input.language },
      components: input.components,
    },
  };

  const res = await axios.post<{ messages?: Array<{ id?: string }> }>(
    `${META_GRAPH_BASE}/${phoneNumberId}/messages`,
    body,
    {
      params: { access_token: accessToken },
      timeout: 15_000,
      validateStatus: () => true,
    },
  );

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Meta messages API error ${res.status}: ${JSON.stringify(res.data)}`);
  }

  const wamid = res.data.messages?.[0]?.id ?? `local-${Date.now()}`;
  return { wamid, status: 'pending' };
}
