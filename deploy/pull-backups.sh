#!/usr/bin/env bash
# Joshua Nunez
# Run ON YOUR MAC. Copies the server's nightly database backups to this computer (keeps what is already here).
#   deploy/pull-backups.sh root@10.50.0.23 [destination-folder]
# The copies hold your agency's real data. Keep the folder private (FileVault on, not in a shared folder).
set -euo pipefail
HOST="${1:?Usage: deploy/pull-backups.sh user@server [folder]}"
DEST="${2:-$HOME/Backups/agencyos}"
mkdir -p "$DEST"
chmod 700 "$DEST"
rsync -a -e ssh "$HOST:/var/lib/agencyos/backups/" "$DEST/"
echo "Backups in $DEST:"
ls -1 "$DEST" | tail -5
