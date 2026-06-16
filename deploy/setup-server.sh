#!/bin/bash
# One-time server bootstrap. Run once after `ssh` into a fresh Ubuntu 22.04
# server. Idempotent — safe to re-run.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/<you>/stock-web/main/deploy/setup-server.sh | bash
# or after `git clone`:
#   sudo bash deploy/setup-server.sh

set -euo pipefail

# ANSI colours for visibility in long output
GRN=$'\033[1;32m'; YLW=$'\033[1;33m'; RED=$'\033[1;31m'; END=$'\033[0m'
log()  { echo "${GRN}==>${END} $*"; }
warn() { echo "${YLW}!! ${END} $*" >&2; }
die()  { echo "${RED}xx ${END} $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run with sudo"

log "updating apt"
apt-get update -qq

log "installing system packages"
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    curl ca-certificates build-essential \
    python3.12 python3.12-venv python3.12-dev \
    redis-server \
    nginx \
    git

# Node 20 — needed only at deploy time to run `next build`. We'll uninstall
# the leftovers after build to keep the runtime footprint small, but it's
# fine to leave it.
if ! command -v node >/dev/null 2>&1; then
    log "installing node 20"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
fi

# uv — fast Python package manager. Installed system-wide for convenience.
if ! command -v uv >/dev/null 2>&1; then
    log "installing uv"
    curl -LsSf https://astral.sh/uv/install.sh | sh
    cp -f "$HOME/.local/bin/uv" /usr/local/bin/uv
fi

log "enabling redis (loopback only)"
systemctl enable --now redis-server
# Keep redis on loopback (default) — no exposure to public internet.
sed -i 's/^# *bind .*/bind 127.0.0.1/' /etc/redis/redis.conf
systemctl restart redis-server

log "creating service user"
id -u stockweb >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin stockweb

log "${GRN}done${END} — system ready. Next step: cd into the project and run deploy/install.sh"
