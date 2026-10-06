#!/usr/bin/env bash
# Joshua Nunez
# Run ON THE SERVER as root, by hand. Asks you to type a setup code (nothing is shown as you type) and stores it
# where only root can read it. The first-run setup page then asks for this code. Nobody else sees it, including me.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
read -rsp "Setup code (at least 12 characters): " CODE; echo
[ "${#CODE}" -ge 12 ] || { echo "Too short." >&2; exit 1; }
case "$CODE" in *[\"\'\ \\\$]*) echo "Use letters, numbers and - _ . only." >&2; exit 1;; esac
umask 077
printf 'SETUP_TOKEN=%s\n' "$CODE" > /etc/agencyos.env
chmod 600 /etc/agencyos.env
systemctl restart agencyos.service
echo "Saved. AgencyOS restarted."
