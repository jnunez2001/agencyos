#!/usr/bin/env bash
# Joshua Nunez
# UNTESTED on the real server.
# Idempotent installer for AgencyOS. Run on the server as root (deploy/push.sh does this for you).
# Touches only its own paths: /opt/agencyos, /var/lib/agencyos, /etc/agencyos.env, its own systemd unit and the
# agencyos user and its nightly backup timer. It does NOT touch Family Money OS, StarkFi, cloudflared, nginx or any other port.
set -euo pipefail

APP_DIR=/opt/agencyos
DATA_DIR=/var/lib/agencyos
PORT=3200
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
command -v node >/dev/null || { echo "Node.js 22 or newer is required." >&2; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || { echo "Node.js 22 or newer is required (found $NODE_MAJOR)." >&2; exit 1; }

if ss -ltn 2>/dev/null | grep -qE "127\.0\.0\.1:${PORT}\b" && ! systemctl is-active --quiet agencyos; then
  echo "Port ${PORT} is already in use by something else. Edit PORT in deploy/agencyos.service first." >&2
  exit 1
fi

id -u agencyos >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin agencyos

mkdir -p "$APP_DIR" "$DATA_DIR"
chown agencyos:agencyos "$DATA_DIR"
chmod 700 "$DATA_DIR"

# Copy app code only. The database in DATA_DIR is never overwritten.
for item in server public database scripts package.json package-lock.json; do
  rm -rf "${APP_DIR:?}/$item"
  cp -R "$SRC/$item" "$APP_DIR/$item"
done
chown -R root:root "$APP_DIR"
(cd "$APP_DIR" && npm ci --omit=dev)

cp "$SRC/deploy/agencyos.service" "$SRC/deploy/agencyos-backup.service" "$SRC/deploy/agencyos-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable agencyos.service
systemctl restart agencyos.service
systemctl enable --now agencyos-backup.timer

echo
echo "Installed. AgencyOS is listening on 127.0.0.1:${PORT} only."
if [ ! -f /etc/agencyos.env ]; then
  echo "No setup code is set yet. Before it is reachable from the internet, run: deploy/set-setup-token.sh (on the server)."
fi
