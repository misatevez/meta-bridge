# meta-bridge smoke monitoring

## Files

| File | Purpose |
|------|---------|
| `meta-bridge-smoke.sh` | Smoke test script |
| `meta-bridge-smoke.cron` | Cron job (every 5 min) |

## Install

```bash
# 1. Copy script
sudo cp infra/monitoring/meta-bridge-smoke.sh /usr/local/bin/meta-bridge-smoke.sh
sudo chmod 755 /usr/local/bin/meta-bridge-smoke.sh

# 2. Install cron
sudo cp infra/monitoring/meta-bridge-smoke.cron /etc/cron.d/meta-bridge-smoke
sudo chmod 644 /etc/cron.d/meta-bridge-smoke

# 3. Create log file
sudo touch /var/log/meta-bridge-smoke.log
sudo chmod 644 /var/log/meta-bridge-smoke.log

# 4. Test manually
sudo /usr/local/bin/meta-bridge-smoke.sh
```

## Email transport

The script tries `mail` command first. If not installed, it falls back to curl SMTP using optional vars in `/etc/meta-bridge/.env`:

```
SMTP_HOST=smtp.hostinger.com
SMTP_USER=marketing@moa-agencia.com
SMTP_PASS=<password>
```

To install `mail`:

```bash
sudo apt-get install -y mailutils
```

## Simulate failure

```bash
# Stop the service
sudo -u ubuntu pm2 stop meta-bridge

# Wait 5 min, or run manually
sudo /usr/local/bin/meta-bridge-smoke.sh

# Recovery
sudo -u ubuntu pm2 start meta-bridge
sudo /usr/local/bin/meta-bridge-smoke.sh  # alert lock clears on pass
```

## Files on server

| Path | Description |
|------|-------------|
| `/usr/local/bin/meta-bridge-smoke.sh` | Script |
| `/etc/cron.d/meta-bridge-smoke` | Cron definition |
| `/var/log/meta-bridge-smoke.log` | Log output |
| `/var/run/meta-bridge-alert.lock` | Anti-spam lock (auto-managed) |
