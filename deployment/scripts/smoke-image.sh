#!/usr/bin/env bash
set -euo pipefail

image="${1:?usage: smoke-image.sh <image>}"
port="${SMOKE_PORT:-3000}"
name="ai-listings-smoke-$$"
name_req="$name-require"
stub_dir="$(mktemp -d)"

cleanup() {
  docker rm -f "$name" "$name_req" >/dev/null 2>&1 || true
  rm -rf "$stub_dir"
}
trap cleanup EXIT

fail() { echo "SMOKE FAIL: $*" >&2; docker logs "$name" 2>&1 | tail -40 >&2 || true; exit 1; }
pass() { echo "ok  - $*"; }

docker run -d --name "$name" -p "$port:3000" \
  -e NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY=smoke-anon-key \
  "$image" >/dev/null

for _ in $(seq 1 60); do
  curl -fsS --max-time 5 -o /dev/null "http://127.0.0.1:$port/login" 2>/dev/null && break
  sleep 1
done

[ "$(docker inspect -f '{{.State.Running}}' "$name")" = true ] || fail "container exited before becoming ready"

[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/login")" = 200 ] || fail "/login did not return 200"
pass "/login returns 200"

[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/dashboard")" = 307 ] || fail "unauthenticated /dashboard did not redirect"
pass "unauthenticated /dashboard redirects"

docker exec "$name" sh -c 'tr "\0" " " < /proc/1/cmdline' | grep -q 'node server.js' || fail "PID 1 does not launch node server.js"
pass "runtime is node"

docker exec "$name" sh -c 'ldd --version 2>&1 | head -1' | grep -Eqi 'gnu libc|glibc' || fail "not a glibc runtime"
pass "glibc runtime"

[ "$(docker exec "$name" id -u)" = 1001 ] || fail "container does not run as uid 1001"
[ "$(docker exec "$name" awk '/^Uid:/ {print $2}' /proc/1/status)" = 1001 ] || fail "PID 1 does not run as uid 1001"
pass "non-root"

docker exec "$name" node --input-type=module -e "import('@anthropic-ai/claude-agent-sdk').then(() => process.exit(0), (e) => { console.error(e); process.exit(1); })" \
  || fail "claude-agent-sdk does not import"
pass "claude-agent-sdk imports"

docker exec "$name" sh -c 'set -e; found=0; for bin in node_modules/@anthropic-ai/claude-agent-sdk-linux-*/claude; do [ -x "$bin" ] || continue; found=1; "$bin" --version; done; [ "$found" = 1 ]' \
  || fail "claude-agent-sdk native binary missing or does not run on this image"
pass "claude-agent-sdk native binary runs"

docker exec "$name" node -e "
const sharp = require('sharp');
sharp({ create: { width: 64, height: 64, channels: 3, background: '#336' } }).resize(32).webp().toBuffer()
  .then((b) => process.exit(b.length > 0 ? 0 : 1), (e) => { console.error(e); process.exit(1); });
" || fail "sharp cannot encode webp"
pass "sharp encodes webp"

echo "process.env.NR_STUB_LOADED='1'" > "$stub_dir/nr-stub.js"
chmod 644 "$stub_dir/nr-stub.js"
req_port="${SMOKE_REQUIRE_PORT:-3001}"
docker run -d --name "$name_req" -p "$req_port:3000" \
  -v "$stub_dir/nr-stub.js:/tmp/nr-stub.js:ro" \
  -e NODE_OPTIONS="--require /tmp/nr-stub.js" \
  -e NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY=smoke-anon-key \
  "$image" >/dev/null

for _ in $(seq 1 60); do
  curl -fsS --max-time 5 -o /dev/null "http://127.0.0.1:$req_port/login" 2>/dev/null && break
  sleep 1
done

name="$name_req"
[ "$(docker inspect -f '{{.State.Running}}' "$name")" = true ] || fail "container with NODE_OPTIONS --require exited"
[ "$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$req_port/login")" = 200 ] || fail "/login did not return 200 under NODE_OPTIONS --require"
pass "starts under NODE_OPTIONS --require"

echo "all smoke checks passed for $image"
