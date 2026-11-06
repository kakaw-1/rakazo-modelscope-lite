#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

export NODE_ENV=development
export SANDBOX_PROVIDER=desktop
export RAKAZO_X11=1
export DISPLAY="${DISPLAY:-:99}"
export PGDATA=/var/lib/rakazo/pgdata
export DATA_DIR=/var/lib/rakazo/data
export POSTGRES_USER=rakazo
export POSTGRES_DB=rakazo
export POSTGRES_HOST_AUTH_METHOD=scram-sha-256
export SIGNUPS_ENABLED=false
export CONTENT_ENCRYPTION=on
export API_HOST=127.0.0.1
export API_PORT=3100
export API_PROXY_TARGET=http://127.0.0.1:3100
export TRUSTED_PROXIES=127.0.0.1
export HOME=/root
export XDG_RUNTIME_DIR=/tmp/rakazo-xdg

required() { [[ -n "${!1:-}" ]] || { echo "[init] Missing environment variable: $1" >&2; exit 1; }; }
for name in POSTGRES_PASSWORD POSTGRES_APP_PASSWORD BETTER_AUTH_SECRET ENCRYPTION_KEY \
            SCREEN_PROXY_SECRET OWNER_EMAIL OWNER_PASSWORD BETTER_AUTH_URL WEB_ORIGIN \
            RAKAZO_HOST TUNNEL_TOKEN; do
  required "$name"
done
if [[ ! "$POSTGRES_PASSWORD" =~ ^[a-fA-F0-9]{32,}$ ]] || \
   [[ ! "$POSTGRES_APP_PASSWORD" =~ ^[a-fA-F0-9]{32,}$ ]]; then
  echo '[init] POSTGRES_PASSWORD and POSTGRES_APP_PASSWORD must each be 32+ hex characters.' >&2
  exit 1
fi
if [[ ! "$ENCRYPTION_KEY" =~ ^[a-fA-F0-9]{64}$ ]]; then
  echo '[init] ENCRYPTION_KEY must be exactly 64 hex characters.' >&2
  exit 1
fi
if ((${#OWNER_PASSWORD} < 16)); then
  echo '[init] OWNER_PASSWORD needs at least 16 characters.' >&2
  exit 1
fi
if [[ "${BETTER_AUTH_URL}" != https://* ]] || [[ "$WEB_ORIGIN" != "$BETTER_AUTH_URL" ]]; then
  echo '[init] Set matching BETTER_AUTH_URL and WEB_ORIGIN using the HTTPS tunnel hostname.' >&2
  exit 1
fi

export DATABASE_MIGRATION_URL="postgresql://rakazo:${POSTGRES_PASSWORD}@127.0.0.1:5432/rakazo"
export DATABASE_URL="postgresql://rakazo_app:${POSTGRES_APP_PASSWORD}@127.0.0.1:5432/rakazo"
export API_URL="${API_URL:-$BETTER_AUTH_URL}"
export RAKAZO_ALLOWED_HOSTS="${RAKAZO_ALLOWED_HOSTS:-$RAKAZO_HOST}"

install -d -m 0700 -o postgres -g postgres "$PGDATA"
install -d -m 0700 -o root -g root "$DATA_DIR" \
  /var/lib/rakazo/chrome /var/lib/rakazo/screenshots "$XDG_RUNTIME_DIR" \
  /app/apps/web/node_modules/.vite-temp
chmod 0700 "$XDG_RUNTIME_DIR"

pids=()
stop_children() {
  trap - EXIT TERM INT
  if ((${#pids[@]})); then
    kill "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
  fi
}
trap stop_children EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

# ModelScope's ONLY published port. Health is deliberately independent of
# the app and database startup, so schema migrations do not cause flapping.
env -i PATH="$PATH" HOME=/root \
  node /app/infra/modelscope-single/health.mjs &
pids+=("$!")

# The official PostgreSQL 16 entrypoint initializes our non-volume PGDATA.
# Local TCP only; no exposed database port.
echo '[init] Starting local PostgreSQL 16...'
docker-entrypoint.sh postgres -c listen_addresses=127.0.0.1 -c password_encryption=scram-sha-256 &
pids+=("$!")

pg_ready=0
for _ in $(seq 1 120); do
  if pg_isready -h 127.0.0.1 -p 5432 -U rakazo >/dev/null 2>&1; then
    pg_ready=1
    break
  fi
  if ! kill -0 "${pids[1]}" 2>/dev/null; then
    echo '[init] PostgreSQL process stopped unexpectedly' >&2
    exit 1
  fi
  sleep 1
done
[[ "$pg_ready" == 1 ]] || { echo '[init] PostgreSQL did not become ready' >&2; exit 1; }

echo '[init] Running Rakazo migrations and app-role provisioning...'
cd /app
# This migration CLI invokes pnpm internally; pnpm is installed in the image.
pnpm --filter @rakazo/api db:deploy

echo '[init] Bootstrapping the owner account...'
node /app/apps/api/dist/cli/bootstrap-owner.js

# The migration owner password must not leak into long-running app subprocesses.
unset DATABASE_MIGRATION_URL POSTGRES_PASSWORD POSTGRES_APP_PASSWORD OWNER_PASSWORD OWNER_EMAIL

# Virtual X screen, window manager and Chrome run as root, like the Desktop Provider.
# IMPORTANT: this offers no host/agent isolation and is testing-only.
echo '[init] Starting X11/Chrome desktop...'
env -i PATH="$PATH" HOME=/root DISPLAY="$DISPLAY" \
  Xvfb "$DISPLAY" -screen 0 "${DESKTOP_RESOLUTION:-1366x768x24}" -nolisten tcp &
pids+=("$!")

x_ready=0
for _ in $(seq 1 80); do
  if env DISPLAY="$DISPLAY" xdpyinfo >/dev/null 2>&1; then
    x_ready=1
    break
  fi
  sleep 0.25
done
[[ "$x_ready" == 1 ]] || { echo '[init] Xvfb failed to start' >&2; exit 1; }

env -i PATH="$PATH" HOME=/root DISPLAY="$DISPLAY" \
  XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" openbox-session &
pids+=("$!")

chrome_args=(
  --no-first-run --no-default-browser-check --disable-dev-shm-usage
  --user-data-dir=/var/lib/rakazo/chrome --window-size=1366,768
)
# Google Chrome refuses to run as root unless --no-sandbox is supplied.
# This is unavoidably insecure in this requested root topology.
echo '[warn] Chrome running as root with --no-sandbox. PRIVATE TESTING ONLY.' >&2
chrome_args+=(--no-sandbox)
env -i PATH="$PATH" HOME=/root DISPLAY="$DISPLAY" \
  XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" LANG="${LANG:-C.UTF-8}" \
  google-chrome-stable "${chrome_args[@]}" about:blank &
pids+=("$!")

# VNC is READ ONLY and loopback-bound. Screen streams are exposed only via
# Rakazo's authenticated /novnc/session proxy; never publish 5900/6080 in CF.
echo '[init] Starting local read-only VNC on 127.0.0.1:5900...'
env -i PATH="$PATH" HOME=/root DISPLAY="$DISPLAY" \
  x11vnc -display "$DISPLAY" -localhost -rfbport 5900 \
  -nopw -viewonly -forever -shared -xkb -quiet &
pids+=("$!")

vnc_ready=0
for _ in $(seq 1 60); do
  if (echo > /dev/tcp/127.0.0.1/5900) 2>/dev/null; then vnc_ready=1; break; fi
  sleep 0.25
done
[[ "$vnc_ready" == 1 ]] || { echo '[init] VNC did not become ready' >&2; exit 1; }

echo '[init] Starting local noVNC/websockify on 127.0.0.1:6080...'
env -i PATH="$PATH" HOME=/root \
  websockify --web /usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900 &
pids+=("$!")

screen_ready=0
for _ in $(seq 1 60); do
  if curl --fail --silent --max-time 2 http://127.0.0.1:6080/vnc.html >/dev/null; then
    screen_ready=1; break
  fi
  sleep 0.25
done
[[ "$screen_ready" == 1 ]] || { echo '[init] noVNC/websockify did not become ready' >&2; exit 1; }

echo '[init] Starting Rakazo API and Worker...'
env -u TUNNEL_TOKEN node --enable-source-maps /app/apps/api/dist/index.js &
pids+=("$!")
env -u TUNNEL_TOKEN node --enable-source-maps /app/apps/worker/dist/index.js &
pids+=("$!")

api_ready=0
for _ in $(seq 1 90); do
  if curl --fail --silent --max-time 2 http://127.0.0.1:3100/ready >/dev/null; then
    api_ready=1
    break
  fi
  sleep 1
done
[[ "$api_ready" == 1 ]] || { echo '[init] Rakazo API did not become ready' >&2; exit 1; }

# Vite preview binds to loopback and is reachable externally ONLY via Tunnel.
echo '[init] Starting Rakazo Web on loopback:5173...'
env -u TUNNEL_TOKEN -u DATABASE_URL -u ENCRYPTION_KEY \
  -u BETTER_AUTH_SECRET -u ENCRYPTION_MASTER_KEYS -u OBJECT_STORAGE_SECRET_ACCESS_KEY \
  pnpm --filter @rakazo/web preview --host 127.0.0.1 --port 5173 &
pids+=("$!")

# Cloudflare's TUNNEL_TOKEN environment variable is used without putting the
# token in command-line arguments. One hostname -> localhost:5173.
echo '[init] Starting Cloudflare Tunnel...'
env -i PATH="$PATH" HOME=/root TUNNEL_TOKEN="$TUNNEL_TOKEN" \
  cloudflared tunnel --no-autoupdate run &
pids+=("$!")
unset TUNNEL_TOKEN

echo '[init] Root application + view-only VNC started; health:7860, CF web:5173, local screen:6080.'
# Any managed process exiting should bring down the experimental all-in-one
# container rather than leave a half-working stack.
wait -n "${pids[@]}" || true
echo '[init] A managed service exited. Stopping the container.' >&2
exit 1
