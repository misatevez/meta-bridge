# Logrotate Configuration for meta-bridge

This directory contains the logrotate configuration for PM2 meta-bridge process logs.

## Files

- `meta-bridge` - logrotate configuration file

## Installation

```bash
# Copy the configuration to /etc/logrotate.d/
sudo cp meta-bridge /etc/logrotate.d/meta-bridge

# Verify file permissions
sudo chmod 644 /etc/logrotate.d/meta-bridge
```

## Testing

```bash
# Dry run (shows what logrotate would do)
sudo logrotate -d /etc/logrotate.d/meta-bridge

# Force rotation (actually rotates the logs)
sudo logrotate -f /etc/logrotate.d/meta-bridge

# Verify logs are being written after rotation
pm2 logs meta-bridge --lines 5
```

## Configuration Details

- **Schedule**: Daily rotation (runs from logrotate cron job)
- **Retention**: 14 days (rotate 14)
- **Compression**: Enabled (compress)
- **Empty files**: Not rotated (notifempty)
- **Missing files**: Ignored (missingok)
- **Truncation**: Use copytruncate (preserves file handles for PM2)

## Why copytruncate?

PM2 holds a file handle to the log files. Using `copytruncate` instead of `rotate` allows PM2 to continue writing to the same file without losing the handle, preventing log gaps.

## Logs Location

The configuration targets the standard PM2 log paths (ubuntu user):
- `/home/ubuntu/.pm2/logs/meta-bridge-out.log` - standard output
- `/home/ubuntu/.pm2/logs/meta-bridge-error.log` - error output

Verify with:
```bash
pm2 show meta-bridge | grep -i "log"
ls -la /home/ubuntu/.pm2/logs/meta-bridge-*
```
