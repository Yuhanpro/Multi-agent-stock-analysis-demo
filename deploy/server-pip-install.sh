#!/bin/bash
# Fallback installer for small mainland VPS where `uv sync` hangs on PyPI/Fastly.
# Creates backend/.venv with Python 3.12 and installs dependencies via pip using
# Aliyun PyPI mirror.

set -euo pipefail

unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy NO_PROXY no_proxy
export PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/

cd /opt/stock-web/backend

PY=/home/stockweb/.local/bin/python3.12
if [[ ! -x "$PY" ]]; then
  echo "Python 3.12 missing at $PY" >&2
  exit 1
fi

rm -rf .venv
"$PY" -m venv .venv

.venv/bin/python -m pip install -U pip setuptools wheel

# TradingAgents vendored editable dependency.
.venv/bin/pip install -e vendor/TradingAgents

# Backend direct dependencies. Keep this list in sync with backend/pyproject.toml.
.venv/bin/pip install \
  fastapi \
  'uvicorn[standard]' \
  sse-starlette \
  pydantic \
  openai \
  yfinance \
  akshare \
  slowapi \
  redis \
  python-dotenv

# Install stock-web backend itself without resolving deps again.
.venv/bin/pip install -e . --no-deps

.venv/bin/python - <<'PY'
from app.main import app
from tradingagents.graph.trading_graph import TradingAgentsGraph
print('backend import OK:', app.title, TradingAgentsGraph.__name__)
PY
