#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 path/to/backup.sql.gz"
  exit 1
fi

BACKUP_PATH="$1"

if [[ ! -f "$BACKUP_PATH" ]]; then
  echo "Backup file not found: $BACKUP_PATH"
  exit 1
fi

POSTGRES_USER="${POSTGRES_USER:-cardkeepr}"
POSTGRES_DB="${POSTGRES_DB:-cardkeepr}"

echo "Restoring database '$POSTGRES_DB' from $BACKUP_PATH"
gunzip -c "$BACKUP_PATH" | docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
echo "Restore complete"
