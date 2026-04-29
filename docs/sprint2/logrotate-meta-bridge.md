# Sprint Cleanup: Logrotate Configuration for meta-bridge (INF-1115)

**Date**: 2026-04-29  
**Status**: Ready for deployment  
**Issue**: [INF-1115](mention://issue/7a907540-ea15-4240-8448-76bee01a1de9)

## Overview

Configured logrotate for PM2 meta-bridge process logs to prevent unbounded disk growth. Mirrors the existing suitecrm-firmas-cron configuration with 14-day retention and daily rotation.

## Configuration

**File**: `/etc/logrotate.d/meta-bridge`

```
/home/ubuntu/.pm2/logs/meta-bridge-out.log
/home/ubuntu/.pm2/logs/meta-bridge-error.log
{
    daily
    rotate 14
    compress
    missingok
    notifempty
    copytruncate
}
```

## Key Decisions

### copytruncate vs rotate

- **copytruncate**: Copy file content → truncate in place → PM2 keeps same file handle
- **rotate**: Rename file → create new file → PM2 may lose handle if not configured properly

**Chosen**: `copytruncate` ensures PM2 continues writing without gaps.

## Installation & Testing

### Install on server

```bash
ssh ubuntu@132.145.128.135
cd meta-bridge
sudo cp infra/logrotate/meta-bridge /etc/logrotate.d/meta-bridge
sudo chmod 644 /etc/logrotate.d/meta-bridge
```

### Test dry-run

```bash
# Shows what would happen
sudo logrotate -d /etc/logrotate.d/meta-bridge

# Should output something like:
# rotating pattern: /home/ubuntu/.pm2/logs/meta-bridge-out.log
# rotating pattern: /home/ubuntu/.pm2/logs/meta-bridge-error.log
# ... no actions taken in this mode
```

### Force rotation test

```bash
# Actually rotates logs
sudo logrotate -f /etc/logrotate.d/meta-bridge

# Verify PM2 still writing
pm2 logs meta-bridge --lines 5

# Check compressed logs
ls -lah /home/ubuntu/.pm2/logs/meta-bridge-* | head -10
```

### Verify file handles preserved

```bash
# Before rotation:
ls -i /home/ubuntu/.pm2/logs/meta-bridge-out.log

# After rotation:
ls -i /home/ubuntu/.pm2/logs/meta-bridge-out.log

# Inode should remain the same (copytruncate preserves)
```

## Standard PM2 Log Paths

PM2 (ubuntu user) stores logs in `/home/ubuntu/.pm2/logs/` by default:
- `meta-bridge-out.log` - stdout from the process
- `meta-bridge-error.log` - stderr from the process

Verify with:
```bash
pm2 show meta-bridge | grep -i "log"
ls -la /home/ubuntu/.pm2/logs/meta-bridge-*
```

## Paridad with suitecrm-firmas-cron

Same configuration exists at `/etc/logrotate.d/suitecrm-firmas-cron` on the server:

```bash
# Reference:
sudo cat /etc/logrotate.d/suitecrm-firmas-cron
```

## Code References

- **Logrotate config**: `infra/logrotate/meta-bridge`
- **Install docs**: `infra/logrotate/README.md`
- **Repo**: https://github.com/misatevez/meta-bridge
- **Smoke test reference**: `infra/monitoring/meta-bridge-smoke.sh` (shows PM2 log paths)

## Deployment

1. Merge PR to `main`
2. SSH to server
3. Pull latest meta-bridge
4. Run: `sudo cp infra/logrotate/meta-bridge /etc/logrotate.d/meta-bridge`
5. Test with dry-run and force rotation
6. Verify PM2 continues writing

## Related Issues

- **INF-1116**: Smoke test recurrent meta-bridge + alert (depends on this for log reliability)
