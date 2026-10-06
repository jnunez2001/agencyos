#!/usr/bin/env bash
# Joshua Nunez
# Run ON THE SERVER as root, by hand. Installs the Google service account key file so AgencyOS can read Search Console
# and Analytics. The key is checked, then stored where only root and the AgencyOS service can read it. Nothing is printed.
#   bash deploy/set-google-key.sh /root/key.json
# Copy the file to the server first (scp key.json root@SERVER:/root/), and delete the copy afterwards.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
SRC="${1:?Usage: set-google-key.sh /path/to/key.json}"
[ -f "$SRC" ] || { echo "File not found: $SRC" >&2; exit 1; }
node -e '
const k = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
if (k.type !== "service_account" || !k.client_email || !k.private_key) { console.error("This is not a Google service account key file."); process.exit(1); }
console.log("Service account: " + k.client_email);
' "$SRC"
install -m 640 -o root -g agencyos "$SRC" /etc/agencyos-google.json
systemctl restart agencyos.service
echo "Installed. AgencyOS restarted. You can now delete $SRC from the server."
