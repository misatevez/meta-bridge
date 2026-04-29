#!/usr/bin/env bash
# Deploy smoke monitoring to the server.
# Run from the repo root on the server: bash infra/monitoring/deploy.sh
set -euo pipefail

SCRIPT_SRC="infra/monitoring/meta-bridge-smoke.sh"
CRON_SRC="infra/monitoring/meta-bridge-smoke.cron"
SERVER_SCRIPT="/usr/local/bin/meta-bridge-smoke.sh"
SERVER_CRON="/etc/cron.d/meta-bridge-smoke"
ENV_DIR="/etc/meta-bridge"

echo "==> Installing smoke script to ${SERVER_SCRIPT}"
sudo cp "$SCRIPT_SRC" "$SERVER_SCRIPT"
sudo chmod 750 "$SERVER_SCRIPT"
sudo chown root:root "$SERVER_SCRIPT"

echo "==> Installing cron to ${SERVER_CRON}"
sudo cp "$CRON_SRC" "$SERVER_CRON"
sudo chmod 644 "$SERVER_CRON"
sudo chown root:root "$SERVER_CRON"

echo "==> Creating ${ENV_DIR}/ if needed"
sudo mkdir -p "$ENV_DIR"
sudo chmod 750 "$ENV_DIR"

if [[ ! -f "${ENV_DIR}/.env" ]]; then
  echo "==> NOTICE: ${ENV_DIR}/.env does not exist — creating template"
  sudo tee "${ENV_DIR}/.env" > /dev/null << 'EOF'
# meta-bridge smoke monitor config
META_VERIFY_TOKEN=REPLACE_WITH_META_VERIFY_TOKEN
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=marketing@moa-agencia.com
SMTP_PASS=REPLACE_WITH_SMTP_PASS
EOF
  sudo chmod 640 "${ENV_DIR}/.env"
  sudo chown root:ubuntu "${ENV_DIR}/.env"
  echo "==> Edit ${ENV_DIR}/.env and fill in real values, then re-run."
  exit 1
else
  echo "==> ${ENV_DIR}/.env already exists — skipping"
fi

echo "==> Reloading cron"
sudo service cron reload

echo "==> Done. Testing script manually:"
sudo "$SERVER_SCRIPT"
