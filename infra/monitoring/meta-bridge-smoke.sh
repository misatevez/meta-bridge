#!/bin/bash
# meta-bridge-smoke.sh — Smoke test: health + webhook verify, with alerting.
# Install: sudo cp infra/monitoring/meta-bridge-smoke.sh /usr/local/bin/meta-bridge-smoke.sh
#          sudo chmod 755 /usr/local/bin/meta-bridge-smoke.sh

set -uo pipefail

ENV_FILE="/etc/meta-bridge/.env"
HEALTH_URL="https://meta-bridge.moacrm.com/health"
WEBHOOK_BASE="https://meta-bridge.moacrm.com/webhook"
ALERT_EMAIL="marketing@moa-agencia.com"
ALERT_LOCK="/var/run/meta-bridge-alert.lock"
LOG_FILE="/var/log/meta-bridge-smoke.log"
ALERT_COOLDOWN=3600
CURL_TIMEOUT=10
PM2_LOG_DIR="/home/ubuntu/.pm2/logs"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# Load META_VERIFY_TOKEN from env file
if [[ ! -f "$ENV_FILE" ]]; then
  log "ERROR: $ENV_FILE not found"
  exit 1
fi

VERIFY_TOKEN=$(grep -E '^META_VERIFY_TOKEN=' "$ENV_FILE" | sed 's/^META_VERIFY_TOKEN=//' | tr -d '"' | tr -d "'" | head -1)
if [[ -z "$VERIFY_TOKEN" ]]; then
  log "ERROR: META_VERIFY_TOKEN not set in $ENV_FILE"
  exit 1
fi

# Load optional SMTP creds for curl fallback
SMTP_HOST=$(grep -E '^SMTP_HOST=' "$ENV_FILE" 2>/dev/null | sed 's/^SMTP_HOST=//' | tr -d '"' | head -1 || true)
SMTP_USER=$(grep -E '^SMTP_USER=' "$ENV_FILE" 2>/dev/null | sed 's/^SMTP_USER=//' | tr -d '"' | head -1 || true)
SMTP_PASS=$(grep -E '^SMTP_PASS=' "$ENV_FILE" 2>/dev/null | sed 's/^SMTP_PASS=//' | tr -d '"' | head -1 || true)

can_alert() {
  if [[ ! -f "$ALERT_LOCK" ]]; then
    return 0
  fi
  local lock_time
  lock_time=$(cat "$ALERT_LOCK" 2>/dev/null || echo 0)
  local now
  now=$(date +%s)
  if (( now - lock_time >= ALERT_COOLDOWN )); then
    return 0
  fi
  return 1
}

get_pm2_tail() {
  local lines=50
  local out=""
  local log_file
  log_file=$(ls -t "$PM2_LOG_DIR"/meta-bridge-out*.log 2>/dev/null | head -1 || true)
  local err_file
  err_file=$(ls -t "$PM2_LOG_DIR"/meta-bridge-error*.log 2>/dev/null | head -1 || true)
  if [[ -n "$log_file" ]]; then
    out+="--- PM2 stdout (last $lines lines: $log_file) ---"$'\n'
    out+=$(tail -n "$lines" "$log_file" 2>/dev/null || true)
    out+=$'\n'
  fi
  if [[ -n "$err_file" ]]; then
    out+="--- PM2 stderr (last $lines lines: $err_file) ---"$'\n'
    out+=$(tail -n "$lines" "$err_file" 2>/dev/null || true)
    out+=$'\n'
  fi
  echo "$out"
}

send_alert() {
  local subject="$1"
  local body="$2"

  if ! can_alert; then
    local last
    last=$(cat "$ALERT_LOCK" 2>/dev/null || echo 0)
    log "ALERT suppressed — cooldown active (last sent: $(date -d "@$last" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -r "$last" 2>/dev/null || echo "$last"))"
    return 0
  fi

  date +%s > "$ALERT_LOCK"

  local full_body
  full_body="$body

$(get_pm2_tail)"

  # Try mail command
  if command -v mail &>/dev/null; then
    if echo "$full_body" | mail -s "$subject" "$ALERT_EMAIL" 2>/dev/null; then
      log "ALERT sent via mail to $ALERT_EMAIL"
      return 0
    fi
  fi

  # Fallback: curl SMTP (requires SMTP_HOST, SMTP_USER, SMTP_PASS in env file)
  if [[ -n "${SMTP_HOST:-}" && -n "${SMTP_USER:-}" && -n "${SMTP_PASS:-}" ]]; then
    local tmp_mail
    tmp_mail=$(mktemp)
    cat > "$tmp_mail" <<EOF
From: $SMTP_USER
To: $ALERT_EMAIL
Subject: $subject

$full_body
EOF
    if curl -fsS \
      --url "smtp://${SMTP_HOST}:587" \
      --ssl-reqd \
      --mail-from "$SMTP_USER" \
      --mail-rcpt "$ALERT_EMAIL" \
      --user "${SMTP_USER}:${SMTP_PASS}" \
      --upload-file "$tmp_mail" \
      --max-time 30 2>/dev/null; then
      log "ALERT sent via curl SMTP to $ALERT_EMAIL"
    else
      log "ERROR: curl SMTP failed"
    fi
    rm -f "$tmp_mail"
    return 0
  fi

  log "ERROR: No mail transport available. Install 'mail' (mailutils) or add SMTP_HOST/SMTP_USER/SMTP_PASS to $ENV_FILE"
}

# --- Smoke checks ---
FAIL=0

log "--- smoke start ---"

# 1. Health check
log "Health: GET $HEALTH_URL"
HTTP_CODE=$(curl -fsS -o /dev/null -w "%{http_code}" --max-time "$CURL_TIMEOUT" "$HEALTH_URL" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
  log "Health: OK ($HTTP_CODE)"
else
  log "Health: FAIL (HTTP $HTTP_CODE)"
  FAIL=1
fi

# 2. Webhook verify
WEBHOOK_URL="${WEBHOOK_BASE}?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=ping"
log "Webhook verify: GET $WEBHOOK_BASE?hub.mode=subscribe&hub.verify_token=***&hub.challenge=ping"
CHALLENGE=$(curl -fsS --max-time "$CURL_TIMEOUT" "$WEBHOOK_URL" 2>/dev/null || echo "")
if [[ "$CHALLENGE" == "ping" ]]; then
  log "Webhook verify: OK (challenge echoed)"
else
  log "Webhook verify: FAIL (got '${CHALLENGE:-<empty>}', expected 'ping')"
  FAIL=1
fi

# --- Result ---
if [[ "$FAIL" -eq 0 ]]; then
  log "SMOKE PASSED"
  if [[ -f "$ALERT_LOCK" ]]; then
    rm -f "$ALERT_LOCK"
    log "Recovery — alert lock cleared"
  fi
else
  log "SMOKE FAILED"
  send_alert "[ALERT] meta-bridge down" "Smoke test failed at $(date).

Host: $(hostname)
Health URL: $HEALTH_URL  → HTTP $HTTP_CODE
Webhook URL: $WEBHOOK_BASE  → challenge='${CHALLENGE:-<empty>}' (expected 'ping')

Check PM2: sudo -u ubuntu pm2 status
Restart:   sudo -u ubuntu pm2 restart meta-bridge"
fi

log "--- smoke end ---"
exit "$FAIL"
