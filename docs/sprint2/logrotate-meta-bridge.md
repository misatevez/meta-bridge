# Logrotate Configuration for meta-bridge PM2 Logs

**Issue:** INF-1115  
**Status:** Deployed to production  
**Date:** 2026-04-29  

## Objective

Set up log rotation for PM2 JSON-formatted logs from the `meta-bridge` process running on `132.145.128.135`.
Ensures logs don't consume all disk space and maintains a rolling 14-day window of logs.

## Configuration Applied

**File:** `/etc/logrotate.d/meta-bridge`

```ini
/home/ubuntu/.pm2/logs/meta-bridge-*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
    sharedscripts
}
```

### Configuration Rationale

- **copytruncate** — Critical for PM2 compatibility. Copies the log file and truncates in place rather than moving it, allowing PM2 to keep writing to the same file handle.
- **daily** — Matches the rotation schedule for other system logs.
- **rotate 14** — Retains 14 days of historical logs (sufficient for incident investigation).
- **compress** — Reduces storage after delaycompress period (saves ~80% disk space on JSON logs).
- **delaycompress** — Delays compression until the next rotation, allowing same-day log access without decompression.
- **missingok** — Gracefully handles cases where PM2 hasn't created a log file yet.
- **notifempty** — Skips rotation for empty log files (reduces unnecessary churn).

## Deployment Steps

### On the server (`ubuntu@132.145.128.135`):

1. **Verify log path:**
   ```bash
   pm2 show meta-bridge
   pm2 logs meta-bridge --lines 0
   ```
   Expected: Log files at `/home/ubuntu/.pm2/logs/meta-bridge-out.log` and/or `meta-bridge-error.log`

2. **Install logrotate config:**
   ```bash
   sudo cp /path/to/infra/logrotate/meta-bridge /etc/logrotate.d/meta-bridge
   sudo chown root:root /etc/logrotate.d/meta-bridge
   sudo chmod 644 /etc/logrotate.d/meta-bridge
   ```

3. **Dry-run test:**
   ```bash
   sudo logrotate -d /etc/logrotate.d/meta-bridge
   ```
   Expected: Output shows what would be rotated (no changes made).

4. **Force first rotation:**
   ```bash
   sudo logrotate -f /etc/logrotate.d/meta-bridge
   ```

5. **Verify PM2 still writes:**
   ```bash
   pm2 logs meta-bridge --lines 5
   sleep 5
   pm2 logs meta-bridge --lines 5
   ```
   Expected: New log lines appear after sleep (confirms copytruncate is working).

6. **Check rotated logs:**
   ```bash
   ls -lh /home/ubuntu/.pm2/logs/ | grep meta-bridge
   ```
   Expected: Original log file size reduced, dated backup with or without .gz extension.

## Verification Checklist

- [x] Configuration file created with correct log paths
- [x] copytruncate option present (PM2 handle preservation)
- [x] Dry-run logrotate check passes
- [x] Forced rotation completes without errors
- [x] PM2 continues logging to original file after rotation
- [x] Rotated logs are compressed (after delaycompress cycle)
- [x] System cron job (`/etc/cron.daily/*` or `cron.daily` directory) will run logrotate automatically

## Related

- Companion config: `/etc/logrotate.d/suitecrm-firmas` (cron scheduler logs)
- Meta-bridge repo: https://github.com/misatevez/meta-bridge
- Sprint 2 Fase A: Bridge infrastructure deployment

## Notes

- Log files are JSON-formatted by Orion (structured logging).
- PM2 writes to separate `-out.log` and `-error.log` files by default; wildcard pattern matches both.
- `copytruncate` is essential due to PM2's daemon model (does not reopen logs on SIGHUP).
