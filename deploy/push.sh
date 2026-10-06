#!/usr/bin/env bash
# Joshua Nunez
# Run ON YOUR MAC from the repo. Tests, copies the code to the server, and reinstalls (keeps the database).
#   deploy/push.sh root@10.50.0.23
# Set SKIP_TESTS=1 to skip the test run.
set -euo pipefail
HOST="${1:?Usage: deploy/push.sh user@server}"
cd "$(dirname "${BASH_SOURCE[0]}")/.."
[ "${SKIP_TESTS:-0}" = "1" ] || npm test
rsync -a --delete --exclude node_modules --exclude data --exclude data-demo --exclude .git --exclude .claude -e ssh ./ "$HOST:agencyos/"
ssh "$HOST" 'cd agencyos && bash deploy/install.sh'
echo "Deployed. On the server: curl -s http://127.0.0.1:3200/api/status"
