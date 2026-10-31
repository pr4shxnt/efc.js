#!/usr/bin/env bash
set -euo pipefail

release_id=${1:?Release ID required}
[[ "$release_id" =~ ^[a-f0-9]{40}-[0-9]+-[0-9]+$ ]] || exit 1
base=/var/www/learn-efc
release="$base/releases/$release_id"
archive="/tmp/learn-efc-$release_id.tar.gz"
trap 'rm -f "$archive"' EXIT

# One-time setup is documented in README.md; fail before changing the live release.
test "$(uname -m)" = x86_64
/usr/bin/node -e 'if (Number(process.versions.node.split(".")[0]) !== 24) process.exit(1)'
test -w "$base/releases"
sudo -n systemctl cat learn-efc.service >/dev/null
test ! -e "$release"
mkdir "$release"
tar -xzf "$archive" -C "$release"
test -f "$release/server.js"

previous=$(readlink -f "$base/current" || true)
ln -s "$release" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"

healthy=false
if sudo -n systemctl restart learn-efc.service; then
  for attempt in {1..30}; do
    if curl --fail --silent --output /dev/null http://127.0.0.1:3000/; then
      healthy=true
      break
    fi
    sleep 2
  done
fi

if [ "$healthy" != true ]; then
  if [ -n "$previous" ] && [ -d "$previous" ]; then
    ln -s "$previous" "$base/current.rollback"
    mv -Tf "$base/current.rollback" "$base/current"
    sudo -n systemctl restart learn-efc.service
  else
    sudo -n systemctl stop learn-efc.service
    rm -f "$base/current"
  fi
  echo 'Release failed its health check; restored the previous release when available.' >&2
  exit 1
fi
echo "Deployed $release_id"
