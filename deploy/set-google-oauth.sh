#!/usr/bin/env bash
# Joshua Nunez
# Run ON THE SERVER as root, by hand. Stores the Google OAuth client (the id and secret you made in Google Cloud) so
# AgencyOS can offer "Add Google account". You type the secret here, hidden; nobody else sees it, including me.
#   bash deploy/set-google-oauth.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
read -rp "Client ID (ends in .apps.googleusercontent.com): " CLIENT_ID
read -rsp "Client secret (hidden): " CLIENT_SECRET; echo
case "$CLIENT_ID" in *.apps.googleusercontent.com) ;; *) echo "That does not look like a Google client ID." >&2; exit 1;; esac
[ "${#CLIENT_SECRET}" -ge 10 ] || { echo "That secret looks too short." >&2; exit 1; }
umask 077
CLIENT_ID="$CLIENT_ID" CLIENT_SECRET="$CLIENT_SECRET" node -e 'require("fs").writeFileSync("/etc/agencyos-google-oauth.json", JSON.stringify({ client_id: process.env.CLIENT_ID, client_secret: process.env.CLIENT_SECRET }))'
chown root:agencyos /etc/agencyos-google-oauth.json
chmod 640 /etc/agencyos-google-oauth.json
systemctl restart agencyos.service
echo "Saved. AgencyOS restarted. In AgencyOS open Settings, Google, and choose Add Google account."
