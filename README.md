# Card Keepr

Card Keepr is a compact self-hosted wallet for discount cards, memberships, library cards, IDs, barcodes, and QR codes. It keeps all its data in a server-side database you control. It supports a wide variety of barcodes.

I needed a way to store these cards on my phone after the iOS app I was using stopped being supported.  

## Features

- Cookie-based login backed by environment credentials
- Fast searchable card vault with favorites and categories
- Barcode and QR display inside each card
- Phone camera capture for front/back ID images
- Built-in barcode/QR scanner when the browser supports `BarcodeDetector`
- Docker Compose deployment with Postgres

## Docker Deployment

Use the example docker compose file as the basis for your own install.  The image is already compiled and hosted on github, or you can compile your own.

## Local Development Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and update the credentials.
3. Start Postgres or use `docker compose up --build`.
4. Run the API with `npm run dev:server`.
5. Run the client with `npm run dev:client`.

## Production

Run `docker compose up --build -d`, then open `http://localhost:3006`.

## Example Docker Compose

Example deployment file lives at `docker-compose.example.yml`.

- Uses literal placeholder values only
- No external environment variable expansion
- Comments explain each field
- Marks which settings are required vs optional

Copy values you want into your real `docker-compose.yml` or deployment stack, then replace placeholder secrets and passwords before running.

## Database backup and restore

App also exposes backup tools in Settings:

- Any user can export all of their own cards as `.json` and import them back later.
- Admin user can download full database backup as `.sql.gz` and restore full database from uploaded `.sql.gz`.
- JSON exports include embedded front/back images because images are stored as data URLs in card rows.
- SQL restore replaces whole database contents.

Backup the entire Postgres database to a gzipped SQL dump:

```bash
./scripts/backup-db.sh
```

Or choose a custom output path:

```bash
./scripts/backup-db.sh backups/my-backup.sql.gz
```

Restore from a gzipped SQL dump:

```bash
./scripts/restore-db.sh backups/my-backup.sql.gz
```

These scripts target the running `postgres` service in `docker compose` and default to the `cardkeepr` database/user unless `POSTGRES_DB` or `POSTGRES_USER` are set in your shell.

User JSON export/import uses app UI only. Import is additive: imported cards are created as new cards and do not overwrite existing cards.

## Notes

- The app stores compressed front/back ID captures as data URLs in Postgres to keep the first version simple.
- `BarcodeDetector` support depends on the browser; manual entry remains available everywhere.
