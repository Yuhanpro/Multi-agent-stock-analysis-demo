#!/bin/bash
# Install / update the stock-web app on a server prepared by setup-server.sh.
# Run after every `git pull` or code change.
#
# Reads PUBLIC_API_BASE + DEEPSEEK_API_KEY from .env in repo root.
# Copies the repo to /opt/stock-web and runs from there, so the service does
# not depend on the SSH user's home directory.
#
# Usage:
#   cd ~/stock-web && sudo bash deploy/install.sh

set -euo pipefail

GRN=$'\033[1;32m'; RED=$'\033[1;31m'; END=$'\033[0m'
log() { echo "${GRN}==>${END} $*"; }
die() { echo "${RED}xx ${END} $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run with sudo"

SRC_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_ROOT="/opt/stock-web"
cd "$SRC_ROOT"

[[ -f .env ]] || die ".env missing — copy .env.example and fill in DEEPSEEK_API_KEY + PUBLIC_API_BASE"

# shellcheck disable=SC1091
set -a; . ./.env; set +a
[[ -n "${DEEPSEEK_API_KEY:-}" ]] || die "DEEPSEEK_API_KEY not set in .env"
[[ -n "${PUBLIC_API_BASE:-}"  ]] || die "PUBLIC_API_BASE not set in .env (e.g. http://1.2.3.4:8080)"

log "syncing source to $APP_ROOT"
mkdir -p "$APP_ROOT"
rsync -a --delete \
    --exclude '.git/' \
    --exclude 'backend/.venv/' \
    --exclude 'frontend/node_modules/' \
    --exclude 'frontend/.next/' \
    --exclude 'frontend/out/' \
    --exclude '.env' \
    "$SRC_ROOT/" "$APP_ROOT/"
chown -R stockweb:stockweb "$APP_ROOT"
# Copy .env separately with restrictive permissions (not owned by stockweb).
install -m 0640 -o root -g stockweb "$SRC_ROOT/.env" "$APP_ROOT/.env"

# ---------- backend -------------------------------------------------------

log "syncing backend Python deps via uv"
cd "$APP_ROOT/backend"
runuser -u stockweb -- bash -lc '
    set -e
    cd /opt/stock-web/backend
    /usr/local/bin/uv sync --frozen
'

log "installing systemd unit"
install -m 0644 "$APP_ROOT/deploy/stock-web-backend.service" /etc/systemd/system/stock-web-backend.service
# Generate the env file the unit reads — keeping secrets in one place.
install -m 0640 -o root -g stockweb /dev/null /etc/stock-web.env
{
    echo "DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}"
    echo "REDIS_URL=redis://127.0.0.1:6379/0"
    echo "CORS_ORIGINS=${PUBLIC_API_BASE}"
    echo "RATE_LIMIT_QUICK=${RATE_LIMIT_QUICK:-5/hour}"
    echo "RATE_LIMIT_DEBATE=${RATE_LIMIT_DEBATE:-1/hour}"
    echo "DAILY_BUDGET_USD=${DAILY_BUDGET_USD:-10}"
    echo "DEEP_THINK_LLM=${DEEP_THINK_LLM:-deepseek-v4-pro}"
    echo "QUICK_THINK_LLM=${QUICK_THINK_LLM:-deepseek-v4-flash}"
    echo "REPO_ROOT=${APP_ROOT}"
} > /etc/stock-web.env
chmod 0640 /etc/stock-web.env
chown root:stockweb /etc/stock-web.env

systemctl daemon-reload
systemctl enable stock-web-backend
systemctl restart stock-web-backend

# ---------- frontend ------------------------------------------------------

log "building frontend (next export)"
cd "$APP_ROOT/frontend"
NEXT_PUBLIC_API_BASE="$PUBLIC_API_BASE" \
    bash -lc 'npm ci --no-audit --no-fund && npm run build'

log "publishing frontend to /var/www/stock-web"
mkdir -p /var/www/stock-web
rsync -a --delete "$APP_ROOT/frontend/out/" /var/www/stock-web/
chown -R www-data:www-data /var/www/stock-web

log "installing nginx site"
if [[ -d /etc/nginx/sites-available && -d /etc/nginx/sites-enabled ]]; then
    # Debian / Ubuntu layout
    install -m 0644 "$APP_ROOT/deploy/nginx.conf" /etc/nginx/sites-available/stock-web
    ln -sf /etc/nginx/sites-available/stock-web /etc/nginx/sites-enabled/stock-web
    rm -f /etc/nginx/sites-enabled/default
else
    # RHEL / Alibaba Cloud Linux layout
    install -m 0644 "$APP_ROOT/deploy/nginx.conf" /etc/nginx/conf.d/stock-web.conf
fi
nginx -t
systemctl reload nginx

# ---------- smoke ---------------------------------------------------------

log "waiting 3s for backend to settle"
sleep 3
if curl -fsS http://127.0.0.1:8000/healthz > /dev/null; then
    log "backend healthz: ${GRN}ok${END}"
else
    die "backend did NOT come up — check: journalctl -u stock-web-backend -n 80"
fi

log "${GRN}deploy complete${END}"
log "  backend:  http://127.0.0.1:8000  (loopback only)"
log "  frontend: served by nginx on :8080"
log "  public:   ${PUBLIC_API_BASE}"
log "  status:   systemctl status stock-web-backend"
log "  logs:     journalctl -u stock-web-backend -f"
