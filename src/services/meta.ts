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

export async function fetchTemplates(wabaId: string, accessToken: string): Promise<WaTemplate[]> {
  const res = await axios.get<{ data?: unknown[] }>(
    `${META_GRAPH_BASE}/${wabaId}/message_templates`,
    {
      params: { access_token: accessToken, limit: 200 },
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
