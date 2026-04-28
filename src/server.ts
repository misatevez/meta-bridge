import mysql from 'mysql2/promise';
import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { createMessageStore } from './db/wa_messages.js';
import { SuiteCrmClient } from './services/suitecrm.js';
import type { CheckStatus, HealthChecks } from './services/health.js';

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  connectionLimit: 5,
  timezone: 'Z',
});

const suitecrm = new SuiteCrmClient(
  config.suitecrm.baseUrl,
  config.suitecrm.oauthClientId,
  config.suitecrm.oauthClientSecret,
);

const healthChecks: HealthChecks = {
  async db(): Promise<CheckStatus> {
    try {
      await pool.query('SELECT 1');
      return 'ok';
    } catch (err) {
      logger.warn({ err }, 'health: db check failed');
      return 'fail';
    }
  },
  async suitecrm(): Promise<CheckStatus> {
    try {
      await suitecrm.getAccessToken();
      return 'ok';
    } catch (err) {
      logger.warn({ err }, 'health: suitecrm check failed');
      return 'fail';
    }
  },
};

const app = createApp({
  messageStore: createMessageStore(pool),
  healthChecks,
});

const server = app.listen(config.port, config.host, () => {
  logger.info(
    { host: config.host, port: config.port, env: config.nodeEnv },
    'meta-bridge listening',
  );
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  server.close(async (err) => {
    try {
      await pool.end();
    } catch (poolErr) {
      logger.warn({ err: poolErr }, 'error closing db pool');
    }
    if (err) {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
    }
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Last-resort handlers. Log + exit so PM2 (or another supervisor) can restart
// the process — safer than continuing in an inconsistent state.
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaughtException — exiting');
  setTimeout(() => process.exit(1), 100).unref();
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandledRejection — exiting');
  setTimeout(() => process.exit(1), 100).unref();
});
