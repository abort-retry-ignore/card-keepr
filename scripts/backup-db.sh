#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(dirname "$(dirname "$0")")"
BACKUP_DIR="$ROOT_DIR/backups"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT_PATH="${1:-$BACKUP_DIR/card-keepr-$TIMESTAMP.sql.gz}"

mkdir -p "$BACKUP_DIR"

POSTGRES_USER="${POSTGRES_USER:-cardkeepr}"
POSTGRES_DB="${POSTGRES_DB:-cardkeepr}"

echo "Backing up database '$POSTGRES_DB' to $OUTPUT_PATH"
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip > "$OUTPUT_PATH"
echo "Backup complete"
