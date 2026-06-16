#!/bin/bash
# Install / update the stock-web app on a server prepared by setup-server.sh.
# Run after every `git pull` or code change.
#
# Reads PUBLIC_API_BASE + DEEPSEEK_API_KEY from .env in repo root.
#
# Usage:
#   cd ~/stock-web && sudo bash deploy/install.sh

set -euo pipefail

GRN=$'\033[1;32m'; RED=$'\033[1;31m'; END=$'\033[0m'
log() { echo "${GRN}==>${END} $*"; }
die() { echo "${RED}xx ${END} $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run with sudo"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

[[ -f .env ]] || die ".env missing — copy .env.example and fill in DEEPSEEK_API_KEY + PUBLIC_API_BASE"

# shellcheck disable=SC1091
set -a; . ./.env; set +a
[[ -n "${DEEPSEEK_API_KEY:-}" ]] || die "DEEPSEEK_API_KEY not set in .env"
[[ -n "${PUBLIC_API_BASE:-}"  ]] || die "PUBLIC_API_BASE not set in .env (e.g. http://1.2.3.4:8080)"

# ---------- backend -------------------------------------------------------

log "syncing backend Python deps via uv"
cd "$REPO_ROOT/backend"
sudo -u stockweb -H bash -lc '
    set -e
    cd "$0"
    /usr/local/bin/uv sync --frozen
' "$REPO_ROOT/backend"

log "fixing ownership"
chown -R stockweb:stockweb "$REPO_ROOT/backend/.venv" "$REPO_ROOT/backend/vendor" 2>/dev/null || true

log "installing systemd unit"
install -m 0644 "$REPO_ROOT/deploy/stock-web-backend.service" /etc/systemd/system/stock-web-backend.service
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
    echo "REPO_ROOT=${REPO_ROOT}"
} > /etc/stock-web.env
chmod 0640 /etc/stock-web.env
chown root:stockweb /etc/stock-web.env

systemctl daemon-reload
systemctl enable stock-web-backend
systemctl restart stock-web-backend

# ---------- frontend ------------------------------------------------------

log "building frontend (next export)"
cd "$REPO_ROOT/frontend"
# build args: bake API base into the static bundle
NEXT_PUBLIC_API_BASE="$PUBLIC_API_BASE" \
    bash -lc 'npm ci --no-audit --no-fund && npm run build'

log "publishing frontend to /var/www/stock-web"
mkdir -p /var/www/stock-web
rsync -a --delete "$REPO_ROOT/frontend/out/" /var/www/stock-web/
chown -R www-data:www-data /var/www/stock-web

log "installing nginx site"
install -m 0644 "$REPO_ROOT/deploy/nginx.conf" /etc/nginx/sites-available/stock-web
ln -sf /etc/nginx/sites-available/stock-web /etc/nginx/sites-enabled/stock-web
# Disable the default welcome site if present
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# ---------- smoke ---------------------------------------------------------

log "waiting 3s for backend to settle"
sleep 3
if curl -fsS http://127.0.0.1:8000/healthz > /dev/null; then
    log "backend healthz: ${GRN}ok${END}"
else
    die "backend did NOT come up — check: journalctl -u stock-web-backend -n 50"
fi

log "${GRN}deploy complete${END}"
log "  backend:  http://127.0.0.1:8000  (loopback only)"
log "  frontend: served by nginx on :8080"
log "  status:   systemctl status stock-web-backend"
log "  logs:     journalctl -u stock-web-backend -f"
