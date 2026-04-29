# Meta-Bridge Logrotate Configuration

## Overview
This directory contains logrotate configuration for PM2 logs of the meta-bridge process.

## Installation

1. Copy the config to the system logrotate directory:
```bash
sudo cp meta-bridge /etc/logrotate.d/meta-bridge
sudo chmod 644 /etc/logrotate.d/meta-bridge
```

2. Test the configuration (dry-run):
```bash
sudo logrotate -d /etc/logrotate.d/meta-bridge
```

3. Force rotation to verify it works:
```bash
sudo logrotate -f /etc/logrotate.d/meta-bridge
```

4. Verify PM2 is still writing logs:
```bash
pm2 logs meta-bridge --lines 5
```

## Configuration Details

- **Target logs**: `/home/ubuntu/.pm2/logs/meta-bridge*.log`
- **Rotation**: Daily
- **Retention**: 14 days
- **Compression**: Enabled (gzip)
- **copytruncate**: Preserves file handle for PM2 to keep writing

## Verification

After installation and force-rotation, verify:

1. Check logrotate status:
```bash
ls -la /home/ubuntu/.pm2/logs/
```

2. Verify PM2 process is still writing:
```bash
pm2 logs meta-bridge --lines 10
```

3. Check for any PM2 errors:
```bash
pm2 show meta-bridge
```

## Notes

The `copytruncate` option ensures PM2 doesn't lose its file handle during rotation - it copies the file contents and truncates the original instead of moving it.
