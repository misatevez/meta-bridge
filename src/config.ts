import 'dotenv/config';

export interface Config {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  host: string;
  logLevel: string;
  meta: {
    appId: string;
    appSecret: string;
    verifyToken: string;
  };
  waba: {
    phoneNumberId: string;
    id: string;
    accessToken: string;
  };
  bridge: {
    apiKey: string;
  };
  suitecrm: {
    baseUrl: string;
    oauthClientId: string;
    oauthClientSecret: string;
  };
  db: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
}

function readEnv(key: string, fallback?: string): string {
  const value = process.env[key];
  if (value !== undefined && value !== '') return value;
  if (fallback !== undefined) return fallback;
  return '';
}

function readEnvInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(): Config {
  const nodeEnv = (readEnv('NODE_ENV', 'development') as Config['nodeEnv']);

  return {
    nodeEnv,
    port: readEnvInt('PORT', 3000),
    host: readEnv('HOST', '127.0.0.1'),
    logLevel: readEnv('LOG_LEVEL', 'info'),
    meta: {
      appId: readEnv('META_APP_ID'),
      appSecret: readEnv('META_APP_SECRET'),
      verifyToken: readEnv('META_VERIFY_TOKEN'),
    },
    waba: {
      phoneNumberId: readEnv('META_WABA_PHONE_NUMBER_ID'),
      id: readEnv('META_WABA_ID'),
      accessToken: readEnv('META_ACCESS_TOKEN'),
    },
    bridge: {
      apiKey: readEnv('BRIDGE_API_KEY'),
    },
    suitecrm: {
      baseUrl: readEnv('SUITECRM_BASE_URL', 'https://firmas.moacrm.com'),
      oauthClientId: readEnv('SUITECRM_OAUTH_CLIENT_ID'),
      oauthClientSecret: readEnv('SUITECRM_OAUTH_CLIENT_SECRET'),
    },
    db: {
      host: readEnv('DB_HOST', '127.0.0.1'),
      port: readEnvInt('DB_PORT', 3306),
      user: readEnv('DB_USER'),
      password: readEnv('DB_PASS'),
      database: readEnv('DB_NAME', 'meta_bridge'),
    },
  };
}

export const config: Config = loadConfig();
