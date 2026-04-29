# Logrotate Configuration for meta-bridge

This directory contains the logrotate configuration for PM2 logs from the `meta-bridge` process.

## Installation

1. Verify the actual log path on the server:
   ```bash
   ssh ubuntu@132.145.128.135
   pm2 show meta-bridge
   pm2 logs meta-bridge --lines 0
   ```

2. Copy the configuration file to the system logrotate directory:
   ```bash
   sudo cp infra/logrotate/meta-bridge /etc/logrotate.d/meta-bridge
   sudo chown root:root /etc/logrotate.d/meta-bridge
   sudo chmod 644 /etc/logrotate.d/meta-bridge
   ```

## Configuration Details

The logrotate config includes:
- **daily**: Rotate logs once per day
- **rotate 14**: Keep 14 rotated log files (14 days of logs)
- **compress**: Compress rotated logs with gzip
- **delaycompress**: Delay compression until the next rotation cycle
- **missingok**: Don't error if log file is missing
- **notifempty**: Don't rotate empty log files
- **copytruncate**: Copy and truncate the log file instead of moving it (allows PM2 to keep writing without losing handle)
- **sharedscripts**: Run scripts once, not for each log file

## Verification

### Dry-run test:
```bash
sudo logrotate -d /etc/logrotate.d/meta-bridge
```

### Force rotation:
```bash
sudo logrotate -f /etc/logrotate.d/meta-bridge
```

### Verify PM2 continues writing:
```bash
pm2 logs meta-bridge --lines 5
```

Should show recent log entries without errors.

## Troubleshooting

If PM2 stops writing logs after rotation:
- Check that the `copytruncate` option is present (allows inode reuse)
- Verify the log path is correct with `pm2 show meta-bridge`
- Check `/var/log/syslog` for logrotate errors

## Related Documentation

See `docs/sprint2/logrotate-meta-bridge.md` for deployment verification and results.
