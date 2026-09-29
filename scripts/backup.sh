#!/bin/sh
# Run from the repository root on the Linux server.
set -eu
umask 077
mkdir -p backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="backups/intent-$stamp.dump"
docker compose exec -T db pg_dump -U intent -d intent -Fc > "$backup.tmp"
test -s "$backup.tmp"
mv "$backup.tmp" "$backup"
printf 'Backup written: %s\n' "$backup"
