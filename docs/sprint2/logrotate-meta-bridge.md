# Sprint 2 - Logrotate Configuration for Meta-Bridge PM2 Logs

**Date:** 2026-04-28  
**Task:** INF-1115 - Setup logrotate for meta-bridge PM2 logs  
**Status:** Implemented

## Context

The meta-bridge service runs under PM2 on the production server at `132.145.128.135`. PM2 writes stdout/stderr logs to `~/.pm2/logs/` directory. Without log rotation, these files would grow indefinitely and eventually fill up the server disk.

## Solution

Created `/etc/logrotate.d/meta-bridge` configuration file with the following settings:

- **Log files**: `/home/ubuntu/.pm2/logs/meta-bridge*.log`
- **Frequency**: Daily rotation
- **Compression**: gzip (enabled)
- **Retention**: 14 days (keeps 14 rotated logs + current)
- **Options**:
  - `missingok`: Don't error if log file is missing
  - `notifempty`: Don't rotate empty log files
  - `copytruncate`: Copy then truncate (preserves PM2 file handles)

## Deployment Steps

1. Copy the logrotate config:
```bash
sudo cp /path/to/infra/logrotate/meta-bridge /etc/logrotate.d/meta-bridge
sudo chmod 644 /etc/logrotate.d/meta-bridge
```

2. Verify configuration (dry-run):
```bash
sudo logrotate -d /etc/logrotate.d/meta-bridge
```

3. Force rotation test:
```bash
sudo logrotate -f /etc/logrotate.d/meta-bridge
```

4. Verify PM2 continues writing after rotation:
```bash
pm2 logs meta-bridge --lines 10
pm2 show meta-bridge
```

## Key Design Decision

We use `copytruncate` instead of the default `mv` behavior because:
- PM2 holds an open file descriptor to stdout/stderr
- Moving the file would orphan that descriptor
- `copytruncate` copies the content and truncates, allowing PM2 to continue writing

This ensures zero log loss and no PM2 restarts needed during rotation.

## Verification Checklist

- [x] Configuration file created in `infra/logrotate/meta-bridge`
- [x] README with installation instructions added
- [x] Documentation in `docs/sprint2/logrotate-meta-bridge.md`
- [x] Committed to repository
- [ ] Deployed to production server
- [ ] Tested with `logrotate -d` (dry-run)
- [ ] Force rotation tested with `logrotate -f`
- [ ] PM2 verified writing after rotation

## References

- PM2 Docs: https://pm2.keymetrics.io/docs/usage/log-files
- Logrotate Manual: https://linux.die.net/man/8/logrotate
- Issue: INF-1115
