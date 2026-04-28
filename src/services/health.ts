import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type CheckStatus = 'ok' | 'fail';

export interface HealthChecks {
  db(): Promise<CheckStatus>;
  suitecrm(): Promise<CheckStatus>;
}

export interface HealthResult {
  status: 'ok' | 'degraded';
  checks: { db: CheckStatus; suitecrm: CheckStatus };
  uptime: number;
  version: string;
}

function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, '..', '..', 'package.json');
    const raw = readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(raw) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const VERSION = readPackageVersion();

export async function evaluateHealth(checks: HealthChecks): Promise<HealthResult> {
  const [db, suitecrm] = await Promise.all([
    checks.db().catch((): CheckStatus => 'fail'),
    checks.suitecrm().catch((): CheckStatus => 'fail'),
  ]);

  const status: HealthResult['status'] =
    db === 'ok' && suitecrm === 'ok' ? 'ok' : 'degraded';

  return {
    status,
    checks: { db, suitecrm },
    uptime: process.uptime(),
    version: VERSION,
  };
}
