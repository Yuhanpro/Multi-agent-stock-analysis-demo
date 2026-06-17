#!/bin/bash
# One-time server bootstrap. Run once after `ssh` into a fresh-ish Linux server.
# Idempotent — safe to re-run.
#
# Tested targets:
# - Alibaba Cloud Linux 3 (OpenAnolis / RHEL-like, dnf/yum)
# - Ubuntu 22.04/24.04 (apt)
#
# Python 3.12 is installed via uv (not apt/dnf), so distro package versions
# don't matter.
#
# Usage after clone/scp:
#   sudo bash deploy/setup-server.sh

set -euo pipefail

GRN=$'\033[1;32m'; YLW=$'\033[1;33m'; RED=$'\033[1;31m'; END=$'\033[0m'
log()  { echo "${GRN}==>${END} $*"; }
warn() { echo "${YLW}!! ${END} $*" >&2; }
die()  { echo "${RED}xx ${END} $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run with sudo"

# This Aliyun box previously had broken proxy env vars pointing at
# 127.0.0.1:7890 / socks5h://127.0.0.1:1080. They caused dnf / curl / uv to
# fail with HTTP 503 tunnel errors. Direct outbound works, so clear all proxy
# env vars for the deployment scripts.
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy NO_PROXY no_proxy

install_packages_apt() {
    log "using apt package manager"
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
        curl ca-certificates build-essential redis-server nginx git rsync tar
}

install_packages_dnf() {
    log "using dnf/yum package manager"
    local PM="dnf"
    command -v dnf >/dev/null 2>&1 || PM="yum"
    $PM install -y -q curl ca-certificates gcc gcc-c++ make redis nginx git rsync tar
}

log "installing system packages"
if command -v apt-get >/dev/null 2>&1; then
    install_packages_apt
elif command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then
    install_packages_dnf
else
    die "unsupported Linux: no apt-get/dnf/yum found"
fi

# Node 20 — needed at deploy time to run `next build`.
if ! command -v node >/dev/null 2>&1; then
    log "installing node 20"
    if command -v apt-get >/dev/null 2>&1; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
    else
        curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
        local_pm="dnf"; command -v dnf >/dev/null 2>&1 || local_pm="yum"
        $local_pm install -y -q nodejs
    fi
fi

# uv — fast Python package manager. Installed system-wide for convenience.
# Alibaba Cloud Linux / mainland networks can make the official installer slow;
# also handle partially-completed installs (e.g. uv exists in /home/admin/.local/bin
# but was not copied to /usr/local/bin before the SSH session was interrupted).
if ! command -v uv >/dev/null 2>&1 && [[ ! -x /usr/local/bin/uv ]]; then
    log "installing uv"
    if [[ -x /home/admin/.local/bin/uv ]]; then
        cp -f /home/admin/.local/bin/uv /usr/local/bin/uv
    elif [[ -x "$HOME/.local/bin/uv" ]]; then
        cp -f "$HOME/.local/bin/uv" /usr/local/bin/uv
    else
        timeout 180s bash -lc 'curl -LsSf https://astral.sh/uv/install.sh | sh'
        if [[ -x "$HOME/.local/bin/uv" ]]; then
            cp -f "$HOME/.local/bin/uv" /usr/local/bin/uv
        else
            die "uv installer finished but uv binary was not found"
        fi
    fi
fi
chmod +x /usr/local/bin/uv
/usr/local/bin/uv --version

log "creating service user"
id -u stockweb >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin stockweb

log "installing Python 3.12 for stockweb via uv"
runuser -u stockweb -- bash -lc 'unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy NO_PROXY no_proxy; cd ~ && /usr/local/bin/uv python install 3.12'

log "enabling redis (loopback only)"
REDIS_SERVICE="redis"
if systemctl list-unit-files | grep -q '^redis-server\.service'; then
    REDIS_SERVICE="redis-server"
fi
systemctl enable --now "$REDIS_SERVICE"

# Keep redis on loopback — no exposure to public internet.
for cfg in /etc/redis/redis.conf /etc/redis.conf; do
    if [[ -f "$cfg" ]]; then
        if grep -q '^# *bind ' "$cfg"; then
            sed -i 's/^# *bind .*/bind 127.0.0.1/' "$cfg"
        elif ! grep -q '^bind ' "$cfg"; then
            echo 'bind 127.0.0.1' >> "$cfg"
        fi
    fi
done
systemctl restart "$REDIS_SERVICE"

log "enabling nginx"
systemctl enable --now nginx

log "opening local firewalld port 18080 if firewalld is running"
if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
    firewall-cmd --add-port=18080/tcp --permanent || true
    firewall-cmd --reload || true
else
    warn "firewalld not running; remember to open TCP 18080 in Alibaba Cloud security group"
fi

log "preparing app directory"
mkdir -p /opt/stock-web
chown -R stockweb:stockweb /opt/stock-web

log "${GRN}done${END} — system ready. Next step: cd into the project and run sudo bash deploy/install.sh"
