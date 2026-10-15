#!/usr/bin/env bash
# Release rehearsal: everything `npm publish` + `npx create-efc-app` would do, against a
# throwaway local registry instead of npm. Run before publishing a release.
#
#   scripts/release-rehearsal/run.sh
#
# Needs: a clean build of the repo (npm ci), MongoDB on 127.0.0.1:27017, Redis on 6379, PostgreSQL reachable as
# $PG_URL_BASE (default postgres://postgres@127.0.0.1:5433), python3, network access
# for npx/verdaccio and the apps' dependencies. Nothing is installed globally on this
# machine: npm's cache, global prefix and user config all live in the state dir.
#
# State goes to ~/.cache/efc-rehearsal: not /tmp (three apps with node_modules plus a cold
# npm cache are ~3 GB — too much for a RAM-backed /tmp), and not inside this repo (npx
# there resolves against the monorepo's workspaces instead of the registry). It is
# wiped at the start of each run and removed after a successful one.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$ROOT/scripts/release-rehearsal"
PG_URL_BASE="${PG_URL_BASE:-postgres://postgres@127.0.0.1:5433}"
S="${EFC_REHEARSAL_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/efc-rehearsal}"
rm -rf "$S" && mkdir -p "$S"
REG=http://127.0.0.1:4873/
# The registry runs in its own process group: killing only npx would leave verdaccio
# itself holding the port for the next run.
trap 'kill -- "-${VERDACCIO:-0}" 2>/dev/null || true' EXIT
if curl -s -o /dev/null "$REG-/ping"; then
  echo "Port 4873 is already in use (another registry?) — stop it first." >&2
  exit 1
fi

cat > "$S/config.yaml" <<YAML
storage: $S/storage
auth: { htpasswd: { file: $S/htpasswd, max_users: 10 } }
uplinks: { npmjs: { url: https://registry.npmjs.org/ } }
packages:
  'express-file-cluster': { access: \$all, publish: \$authenticated }
  'create-efc-app': { access: \$all, publish: \$authenticated }
  'express-file-cluster-mcp': { access: \$all, publish: \$authenticated }
  '**': { access: \$all, publish: \$authenticated, proxy: npmjs }
listen: 127.0.0.1:4873
log: { type: file, path: $S/verdaccio.log, level: warn }
YAML
echo "== local registry ($S)"
setsid npx -y verdaccio@6 --config "$S/config.yaml" > "$S/verdaccio.out" 2>&1 &
VERDACCIO=$!
for _ in $(seq 1 60); do curl -sf -o /dev/null "$REG-/ping" && break; sleep 2; done

# Throwaway user on the throwaway registry; the token only ever lives in $S/npmrc.
TOKEN=$(curl -s -X PUT "$REG-/user/org.couchdb.user:rehearsal" -H 'content-type: application/json' \
  -d "{\"name\":\"rehearsal\",\"password\":\"$(openssl rand -hex 16)\"}" |
  node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).token")
printf 'registry=%s\n//127.0.0.1:4873/:_authToken=%s\n' "$REG" "$TOKEN" > "$S/npmrc"
unset TOKEN

echo "== build + publish"
(cd "$ROOT" && npm run build > "$S/build.log" 2>&1)
for pkg in core create-efc-app mcp; do
  if ! npm_config_userconfig="$S/npmrc" npm publish "$ROOT/packages/$pkg" --registry "$REG" > "$S/publish-$pkg.log" 2>&1; then
    tail -20 "$S/publish-$pkg.log"; exit 1
  fi
  grep '^+' "$S/publish-$pkg.log"
done
export CEA_VERSION; CEA_VERSION=$(node -p "require('$ROOT/packages/create-efc-app/package.json').version")

mkdir -p "$S/apps"
for spec in "mongo-app ts mongodb bullmq" "pg-app ts postgresql pg-boss" "js-app js postgresql pg-boss"; do
  set -- $spec
  echo; echo "################ $1 ($2, $3, $4)"
  url=""
  if [ "$3" = mongodb ]; then
    # The scaffolded .env points at mongodb://localhost:27017/<app>; start from an empty one.
    (cd "$ROOT" && node --input-type=module -e "import m from 'mongoose'; await m.connect('mongodb://127.0.0.1:27017/$1'); await m.connection.dropDatabase(); await m.disconnect();")
  fi
  if [ "$3" = postgresql ]; then
    url="$PG_URL_BASE/$1"
    psql "$PG_URL_BASE/postgres" -qc "drop database if exists \"$1\" with (force)" -c "create database \"$1\"" >/dev/null
  fi
  if ! python3 "$HERE/drive.py" "$S" "$S/apps" "$@" > "$S/drive-$1.log" 2>&1 || [ ! -f "$S/apps/$1/package.json" ]; then
    tail -30 "$S/drive-$1.log"; echo "FAIL npx create-efc-app"; exit 1
  fi
  echo "ok   npx create-efc-app@$CEA_VERSION"
  bash "$HERE/journey.sh" "$S" "$S/apps/$1" $url
done
# The MCP server, the way an agent's client starts it: `npx -y express-file-cluster-mcp`.
echo; echo "################ express-file-cluster-mcp"
MCP_VERSION=$(node -p "require('$ROOT/packages/mcp/package.json').version")
mkdir -p "$S/mcp-client"
cp "$HERE/mcp-check.mjs" "$S/mcp-client/"
export npm_config_userconfig="$S/npmrc" npm_config_cache="$S/cache" npm_config_prefix="$S/global"
if ! (cd "$S/mcp-client" && npm init -y > /dev/null && npm install --no-audit --no-fund @modelcontextprotocol/sdk > "$S/mcp-install.log" 2>&1 &&
  node mcp-check.mjs "express-file-cluster-mcp@$MCP_VERSION" "$(node -p "require('$ROOT/packages/core/package.json').version")"); then
  echo "FAIL npx express-file-cluster-mcp"; exit 1
fi

kill -- "-$VERDACCIO" 2>/dev/null || true
rm -rf "$S"
echo; echo "Release rehearsal passed."
