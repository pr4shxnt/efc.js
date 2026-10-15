#!/usr/bin/env bash
# Follows the scaffolder's outro with the GLOBALLY installed efc, like a user would:
# dev server straight after scaffolding (no migrate: tables appear on first use) →
# migrate → sync check → build → production server, checking auth over HTTP each time.
# Usage: journey.sh <state dir> <app dir> [DATABASE_URL override]
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; S="$1"; shift; EFC="$S/global/bin/efc"; cd "$1"; OVERRIDE="${2:-}"; [ -n "$OVERRIDE" ] && export DATABASE_URL="$OVERRIDE"
step() { echo; echo "== $*"; }
port() { node -e "const s=require('net').createServer().listen(0,()=>{console.log(s.address().port);s.close()})"; }
step "efc start dev"; P=$(port); PORT=$P "$EFC" start dev > dev.log 2>&1 & DEV=$!
node "$HERE/http.mjs" "http://127.0.0.1:$P/v1/api" || { tail -20 dev.log; kill $DEV; exit 1; }
kill -TERM $DEV; wait $DEV 2>/dev/null
step "efc db migrate (optional now — tables were created on first use)"; "$EFC" db migrate || exit 1
step "efc db sync --dry-run"; "$EFC" db sync --dry-run | tee sync.log | tail -2; grep -q "Everything in sync" sync.log || { echo "FAIL schema drift after first use"; exit 1; }; echo "ok   schema in sync"
step "efc build prod"; "$EFC" build prod > build.log 2>&1 || { tail -20 build.log; exit 1; }; echo "ok   build"
step "efc start prod (env injected like a host would, .env not read)"; P=$(port)
set -a; . ./.env; set +a; [ -n "$OVERRIDE" ] && export DATABASE_URL="$OVERRIDE"; export PORT=$P NODE_ENV=production
"$EFC" start prod > prod.log 2>&1 & PROD=$!
node "$HERE/http.mjs" "http://127.0.0.1:$P/v1/api" || { tail -20 prod.log; kill $PROD; exit 1; }
kill -TERM $PROD; wait $PROD; CODE=$?
[ "$CODE" -eq 0 ] || { echo "FAIL SIGTERM → exit code $CODE"; tail -20 prod.log; exit 1; }
echo "ok   SIGTERM → exit code 0"
