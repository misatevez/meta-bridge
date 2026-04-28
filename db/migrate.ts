import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { config } from '../src/config.js';
import { logger } from '../src/logger.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const FILE_RE = /^(\d{3,})-[\w-]+\.sql$/;

async function ensureMigrationsTable(conn: mysql.Connection): Promise<void> {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS \`_migrations\` (
      \`version\`     VARCHAR(64)  NOT NULL,
      \`name\`        VARCHAR(255) NOT NULL,
      \`applied_at\`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`version\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function appliedVersions(conn: mysql.Connection): Promise<Set<string>> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    'SELECT `version` FROM `_migrations`',
  );
  return new Set(rows.map((r) => String(r.version)));
}

function splitStatements(sql: string): string[] {
  // Strip line comments, keep string literals intact, split on `;` at statement
  // boundaries. Migration files are hand-written and stay simple — no procedures
  // with embedded semicolons, no DELIMITER directives.
  const out: string[] = [];
  let buf = '';
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (!inSingle && !inDouble && !inBacktick && ch === '-' && next === '-') {
      // skip until end of line
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (!inDouble && !inBacktick && ch === "'" && sql[i - 1] !== '\\') inSingle = !inSingle;
    else if (!inSingle && !inBacktick && ch === '"' && sql[i - 1] !== '\\') inDouble = !inDouble;
    else if (!inSingle && !inDouble && ch === '`') inBacktick = !inBacktick;
    if (ch === ';' && !inSingle && !inDouble && !inBacktick) {
      const stmt = buf.trim();
      if (stmt) out.push(stmt);
      buf = '';
    } else {
      buf += ch;
    }
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

interface MigrationFile {
  version: string;
  name: string;
  path: string;
}

async function listMigrations(): Promise<MigrationFile[]> {
  const files = await readdir(MIGRATIONS_DIR);
  const out: MigrationFile[] = [];
  for (const f of files) {
    const m = FILE_RE.exec(f);
    if (!m) continue;
    out.push({ version: m[1]!, name: f.replace(/\.sql$/, ''), path: join(MIGRATIONS_DIR, f) });
  }
  out.sort((a, b) => a.version.localeCompare(b.version));
  return out;
}

async function runMigration(conn: mysql.Connection, file: MigrationFile): Promise<void> {
  const sql = await readFile(file.path, 'utf8');
  const stmts = splitStatements(sql);
  for (const stmt of stmts) {
    await conn.query(stmt);
  }
  await conn.query(
    'INSERT INTO `_migrations` (`version`, `name`) VALUES (?, ?)',
    [file.version, file.name],
  );
}

async function main(): Promise<void> {
  const { db } = config;
  if (!db.user || !db.password || !db.host || !db.database) {
    logger.error('DB_HOST, DB_USER, DB_PASS and DB_NAME are required');
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    database: db.database,
    multipleStatements: false,
    timezone: 'Z',
  });

  try {
    await ensureMigrationsTable(conn);
    const applied = await appliedVersions(conn);
    const files = await listMigrations();

    if (files.length === 0) {
      logger.info('no migrations found');
      return;
    }

    let ran = 0;
    for (const file of files) {
      if (applied.has(file.version)) {
        logger.info({ version: file.version, name: file.name }, 'skip — already applied');
        continue;
      }
      logger.info({ version: file.version, name: file.name }, 'applying');
      await runMigration(conn, file);
      ran++;
    }
    logger.info({ ran, total: files.length }, 'migrations complete');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  logger.error({ err }, 'migration failed');
  process.exit(1);
});
