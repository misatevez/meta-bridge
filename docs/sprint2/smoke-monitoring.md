# Smoke Monitoring — meta-bridge

Sprint 2 B7 · Hardening · INF-1116

## Overview

Active monitoring for `meta-bridge.moacrm.com`. A cron job runs every 5 minutes, checks two endpoints, and sends a single email alert per failure window.

## Architecture

```
cron (*/5 min, root)
  └─ /usr/local/bin/meta-bridge-smoke.sh
       ├─ curl /health        → must return HTTP 200
       ├─ curl /webhook?...   → must echo challenge
       ├─ FAIL → can_alert?
       │        ├─ YES → write lock + send mail → exit 1
       │        └─ NO  → suppress (cooldown) → exit 1
       └─ PASS → clear lock → exit 0
```

## Script logic

### Checks

| Check | URL | Pass condition |
|-------|-----|----------------|
| Health | `https://meta-bridge.moacrm.com/health` | HTTP 200, timeout 10s |
| Webhook verify | `https://meta-bridge.moacrm.com/webhook?hub.mode=subscribe&hub.verify_token=<TOKEN>&hub.challenge=ping` | Body equals `ping` |

`META_VERIFY_TOKEN` is read from `/etc/meta-bridge/.env` — never hardcoded in the script.

### Anti-spam logic

- Lock file: `/var/run/meta-bridge-alert.lock` contains a Unix timestamp.
- **On failure:** if no lock or lock older than 3600 s → send alert + write timestamp. Otherwise suppress.
- **On recovery:** delete lock file. Next failure starts a new alert window.
- Effect: at most 1 alert email per hour during a sustained outage, then silence until recovery + next failure.

### Email transport

1. `mail` command (requires a system MTA — `mailutils` + configured relay).
2. Curl SMTP fallback: reads `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` from `/etc/meta-bridge/.env`.

Alert subject: `[ALERT] meta-bridge down`
Alert body: timestamp, failed checks, last 50 lines of PM2 stdout + stderr logs.

### Recovery notification

No separate recovery email — suppression is lifted when the lock file is deleted on a passing run. The next failure (if any) will again send a fresh alert.

## Installation

```bash
sudo cp infra/monitoring/meta-bridge-smoke.sh /usr/local/bin/meta-bridge-smoke.sh
sudo chmod 755 /usr/local/bin/meta-bridge-smoke.sh

sudo cp infra/monitoring/meta-bridge-smoke.cron /etc/cron.d/meta-bridge-smoke
sudo chmod 644 /etc/cron.d/meta-bridge-smoke

sudo touch /var/log/meta-bridge-smoke.log
sudo chmod 644 /var/log/meta-bridge-smoke.log
```

Optional — configure SMTP relay in `/etc/meta-bridge/.env`:

```
SMTP_HOST=smtp.hostinger.com
SMTP_USER=marketing@moa-agencia.com
SMTP_PASS=<password>
```

Or install `mailutils` and configure a local relay pointing to Hostinger:

```bash
sudo apt-get install -y mailutils
```

## Verification procedure

1. **Force failure:**
   ```bash
   sudo -u ubuntu pm2 stop meta-bridge
   ```
2. Wait up to 5 minutes (or run `sudo /usr/local/bin/meta-bridge-smoke.sh` manually).
3. Confirm email received at `marketing@moa-agencia.com` with subject `[ALERT] meta-bridge down`.
4. **Recovery:**
   ```bash
   sudo -u ubuntu pm2 start meta-bridge
   sudo /usr/local/bin/meta-bridge-smoke.sh  # should log SMOKE PASSED + "alert lock cleared"
   ```
5. Confirm `/var/run/meta-bridge-alert.lock` is removed.
6. **Anti-spam:** stop again, run script twice within 1 minute — second run should log "ALERT suppressed".

## Log format

```
[2026-04-28 14:00:01] --- smoke start ---
[2026-04-28 14:00:01] Health: GET https://meta-bridge.moacrm.com/health
[2026-04-28 14:00:02] Health: OK (200)
[2026-04-28 14:00:02] Webhook verify: GET https://meta-bridge.moacrm.com/webhook?...
[2026-04-28 14:00:03] Webhook verify: OK (challenge echoed)
[2026-04-28 14:00:03] SMOKE PASSED
[2026-04-28 14:00:03] --- smoke end ---
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Health FAIL (000) | Bridge down or network | `pm2 restart meta-bridge` |
| Webhook FAIL (empty) | Bridge up but META_VERIFY_TOKEN mismatch | Check `/etc/meta-bridge/.env` vs running config |
| No email received | No MTA configured | Install `mailutils` or add SMTP_* vars |
| Log not created | `/var/log/meta-bridge-smoke.log` missing | `sudo touch /var/log/meta-bridge-smoke.log && sudo chmod 644 /var/log/meta-bridge-smoke.log` |
| Alert every run | Lock file unwritable | `sudo rm -f /var/run/meta-bridge-alert.lock` |

## File inventory

| Server path | Source |
|-------------|--------|
| `/usr/local/bin/meta-bridge-smoke.sh` | `infra/monitoring/meta-bridge-smoke.sh` |
| `/etc/cron.d/meta-bridge-smoke` | `infra/monitoring/meta-bridge-smoke.cron` |
| `/var/log/meta-bridge-smoke.log` | created on install |
| `/var/run/meta-bridge-alert.lock` | auto-managed by script |
