#!/usr/bin/env bash
# Nightly backup of the SQLite database and uploaded documents.
# Uses SQLite's online backup API (safe with WAL mode, no downtime).
# Install via cron:  0 3 * * * /root/familyoffice/deploy/backup.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="$APP_DIR/deploy/backups"
STAMP="$(date +%Y-%m-%d)"
KEEP_DAYS=14

mkdir -p "$BACKUP_DIR"

cd "$APP_DIR"
docker compose exec -T app node -e "
  const db = require('better-sqlite3')('/app/data/familyoffice.db');
  db.backup('/app/data/backup.db.tmp').then(() => process.exit(0));
"
mv "$APP_DIR/data/backup.db.tmp" "$BACKUP_DIR/familyoffice-$STAMP.db"

tar -czf "$BACKUP_DIR/uploads-$STAMP.tar.gz" -C "$APP_DIR" uploads

find "$BACKUP_DIR" -type f -mtime +"$KEEP_DAYS" -delete

echo "Backup complete: $BACKUP_DIR/familyoffice-$STAMP.db"
