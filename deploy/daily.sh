#!/usr/bin/env bash
# Daily automation: refresh prices, log dividends, snapshot net worth.
# Install via cron (6:15pm, after ASX close):
#   15 18 * * * /root/familyoffice/deploy/daily.sh >> /var/log/familyoffice-daily.log 2>&1
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"

SECRET="$(grep -E '^(CRON_SECRET|JWT_SECRET)=' "$APP_DIR/.env.production" | head -1 | cut -d= -f2- | tr -d "'\"")"

echo "[$(date -Is)] running daily job"
curl -fsS -X POST -H "X-Cron-Secret: $SECRET" http://127.0.0.1:3000/api/cron/daily
echo
