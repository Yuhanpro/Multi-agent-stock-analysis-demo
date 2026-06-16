# stock-web — design document

This is the full design / architecture record. Reading this should get you
up to speed on every non-obvious choice we made and why.

For setup instructions see [README.md](../README.md). For deployment see
[DEPLOY.md](../DEPLOY.md).

---

## 1. Goal

Wrap the TradingAgents multi-agent debate framework and the Buffett value
investing skill into a public-facing demo. Friends type a ticker, watch
the agents argue, get a verdict.

Three constraints shaped everything else:

1. **Cost ceiling**. Multi-agent debate hits the LLM 10-15 times per run —
   without a budget gate, one bored visitor can burn through a $20 API
   credit in an afternoon. So: per-IP rate limit + global daily $ cap.
2. **Streaming.** "Wait 5 minutes for a wall of text" is unacceptable. We
   wanted: token-by-token for single-agent, agent-by-agent for the debate.
3. **Public-facing in China.** Friends are mainland users without VPNs.
   Railway / Vercel / Cloudflare don't reach them well. Final plan:
   single VPS in a Chinese region, ICP filing for HTTPS later.

---

## 2. Stack — final

| Layer | Pick | Why |
|---|---|---|
| LLM | **DeepSeek V4** (`deepseek-v4-pro` for debate deep-think, `deepseek-v4-flash` for quick + TA internal) | OpenAI-compatible API, ¥-priced, mainland-friendly. V4 is current generation; legacy `deepseek-chat` aliases retire 2026-07-24. |
| Backend framework | FastAPI + uv + Python 3.12 | TradingAgents is Python; `import` it directly is the only sane path. uv beats pip for speed and lockfile rigor. |
| Streaming | sse-starlette | SSE plays nicer than WebSockets through nginx + cloud LBs. |
| Frontend | Next.js 14 App Router (`output: "export"`) + Tailwind 3 + recharts | Static export means nginx serves files directly — no Node process at runtime. App Router for forward compat. |
| Rate / budget | Redis (prod) or in-process dict (dev) | Per-IP sliding window + global daily $ counter, both atomic via Redis pipelines. |
| Markets | yfinance (US) + akshare (CN A-shares) | Free, decent quality. yfinance occasionally returns NaN tail rows — guarded. |
| Deployment | bare systemd on Ubuntu 22.04 VPS, no Docker | Saves ~250 MB RAM, simpler debug, no daemon. Single-tenant demo doesn't need isolation. |
| TLS | Let's Encrypt via certbot (Stage B, after ICP) | One command. |

---

## 3. Things we evaluated and did NOT pick

| Considered | Rejected because |
|---|---|
| Railway + Vercel | Mainland China connectivity is poor. Friends without VPNs would see hangs and CORS failures. |
| Anthropic Claude API | Pricing 10x DeepSeek for similar Chinese-language quality on this task. |
| Volcengine Ark / OpenAI Responses API | Volcengine wraps DeepSeek behind an `ep-...` endpoint id; one extra console step buys nothing here. langchain_openai's new default routes to OpenAI's `/v1/responses`, which DeepSeek doesn't implement → 404. We use TradingAgents' built-in `llm_provider="deepseek"` to side-step. |
| Docker | Adds ~250 MB RAM overhead, indirection in debugging. Single-VPS demo doesn't need the isolation guarantees. |
| slowapi for rate limiting | Decorator runs at handler entry — typoed tickers burn quota. Replaced with a 100-line custom sliding-window limiter called explicitly after snapshot pre-fetch. |
| stock-deep-analyzer skill suite (uzi-skill plugin) | Hard-coded to Claude Code's local-tool ecosystem (Read / Bash / Playwright). Can't be lifted to a public API. |
| Stream debate token-by-token | TradingAgents nodes block on full LLM completions before yielding state. Token streaming would need invasive patches. Per-agent granularity is fine — UX shows spinners + cards. |
| `EventSource` (built-in browser SSE) | GET-only. Our endpoints take JSON bodies. Hand-rolled `fetch + ReadableStream` parser instead. |

---

## 4. Architecture

```
                 user's browser
                       │
                       ▼
              [ nginx :8080 ]
              /            \
             /              \
   /api/* reverse proxy    static frontend
            │              (Next export, no JS server)
            ▼
   [ uvicorn :8000 ] ── reads /etc/stock-web.env
            │
       ┌────┴───────────────┐
       │                    │
       ▼                    ▼
   FastAPI routes      services/
       │              ┌─ market_data.py     (yfinance / akshare)
       │              ├─ skill_runner.py    (buffett → DeepSeek)
       │              ├─ tradingagents_runner.py  (LangGraph stream)
       │              ├─ rate_limit.py
       │              └─ budget.py
       │
       └─→ Redis :6379 (loopback only) — counters
       └─→ DeepSeek API (HTTPS outbound)
       └─→ TradingAgents (vendored, imported, in-process)
```

### Backend modules

- **`app/main.py`** — wires CORS, mounts routers, exposes `/healthz` with
  budget + rate-limit status.
- **`app/config.py`** — reads env once, returns frozen `Settings`. Keys we
  care about: `DEEPSEEK_API_KEY`, `DEEP_THINK_LLM`, `QUICK_THINK_LLM`,
  `RATE_LIMIT_QUICK`, `RATE_LIMIT_DEBATE`, `DAILY_BUDGET_USD`,
  `CORS_ORIGINS`, `REDIS_URL` (`memory` for in-process fallback).
- **`app/routes/snapshot.py`** — `GET /api/snapshot?ticker=AAPL&market=US`.
  Synchronous. Returns OHLCV array + 6 fundamental stats.
- **`app/routes/quick.py`** — `POST /api/quick`. Pre-fetches snapshot,
  enforces rate limit + budget, opens SSE, streams tokens.
- **`app/routes/debate.py`** — `POST /api/debate`. Same gating, then drives
  the LangGraph stream.
- **`app/services/market_data.py`** — unified yfinance/akshare wrapper.
  Pydantic models for `Snapshot/OHLCV/Fundamentals`. Drops trailing NaN
  rows (yfinance occasionally tails the current trading day with NaN
  Close before the bar closes).
- **`app/services/skill_runner.py`** — loads `prompts/buffett/SKILL.md` +
  all 8 reference files at boot, prepends an "API Mode Adapter" preamble
  (replaces "use Read tool" with "references already inlined below"),
  caches the result. Exposes `stream_quick(...)` async generator.
- **`app/services/tradingagents_runner.py`** — wraps
  `TradingAgentsGraph.graph.stream(stream_mode="values")`. Diffs
  successive state snapshots to detect:
  - agent reports flipping from empty to filled → `agent_complete` event
  - `investment_debate_state.{bull,bear,judge}_history` growth → `debate_turn`
  - `risk_debate_state.{aggressive,conservative,neutral,judge}_history` growth
  - `final_trade_decision` arrival → `final` event
  Pushes the sync generator through `asyncio.Queue` + `loop.run_in_executor`
  so the FastAPI event loop stays responsive.
- **`app/services/rate_limit.py`** — sliding-window per `(scope, IP)`,
  `_MemoryBackend` (lock + dict) or `_RedisBackend` (atomic INCR + EXPIRE NX).
  `check_and_count(request, scope, limit)` is called *after* validation.
- **`app/services/budget.py`** — daily $ cap by UTC date. Same backend
  shape. `assert_within_budget()` raises HTTP 429; `add_cost(usd)` records
  spend at `done` event time.

### Frontend modules

- **`app/page.tsx`** — single-page state machine. Mode selector
  (snapshot / quick / debate), ticker input, snapshot card, then either
  `<QuickResult />` or `<DebateStream />`. `key={runId}` forces full
  remount on re-run so the previous SSE stream cleanly aborts.
- **`lib/sse.ts`** — `streamSSE(path, body, handlers)`. Uses
  `fetch + ReadableStream + TextDecoder`, parses CRLF-tolerant SSE frames,
  invokes `onEvent(event, data)`. Returns `{ abort }` for `useEffect` cleanup.
- **`lib/i18n.tsx`** — `<I18nProvider>` + `useT()`. Flat dict, ~150 keys,
  EN + zh. Hydrates from localStorage; falls back to navigator.language.
- **`components/quick-result.tsx`** — token-streaming markdown. Shows
  spinner until first chunk; appends `data.text` to a string, renders
  via react-markdown + remark-gfm; cursor span when in-flight.
- **`components/debate-stream.tsx`** — three sections:
  1. analyst card grid (3 cards, spinner → ✓ → click to expand markdown)
  2. investment debate group (bull green / bear red / judge accent)
  3. risk debate group (aggressive / conservative / neutral / chair)
  4. final card with extracted hero verdict (BUY/SELL/HOLD), TL;DR
     sentence (regex over Executive Summary / 执行摘要 / Reasoning / 理由),
     and key facts (price target, stop loss, time horizon, position
     sizing) lifted out as small pills. Full text collapsed by default.

### Deploy modules

- **`deploy/setup-server.sh`** — one-time. Installs Python 3.12 (system),
  Node 20, Redis (loopback only), nginx, uv. Creates `stockweb` system
  user with `/usr/sbin/nologin`.
- **`deploy/install.sh`** — idempotent. Runs after every `git pull`.
  Steps: `uv sync` as `stockweb`, write `/etc/stock-web.env` (mode 0640
  root:stockweb), install systemd unit, restart, `npm ci && npm run build`,
  rsync `frontend/out/` to `/var/www/stock-web/`, install nginx site,
  `nginx -t && systemctl reload nginx`, curl `/healthz` to confirm.
- **`deploy/stock-web-backend.service`** — systemd unit. `Restart=always`,
  `MemoryMax=2G`, hardening: `NoNewPrivileges`, `ProtectSystem=strict`,
  `PrivateTmp`, `ProtectHome`, etc.
- **`deploy/nginx.conf`** — listens on 8080 (port 80 is blocked by Chinese
  ISPs for unfiled domains). Static root + `/api/*` reverse proxy with
  SSE-friendly settings: `proxy_buffering off`, `proxy_request_buffering off`,
  `chunked_transfer_encoding on`, `add_header X-Accel-Buffering no`,
  `proxy_read_timeout 600s`.

---

## 5. SSE event protocol

Both `/api/quick` and `/api/debate` use these conventions:

```
event: snapshot
data: {"ticker": "AAPL", "market": "US", "price": 291.13, ...}

# quick only:
event: meta
data: {"model": "deepseek-v4-flash", "skill": "buffett"}

event: token
data: {"text": "## "}

event: token
data: {"text": "Conclusion"}

# debate only:
event: meta
data: {"ticker": "AAPL", "model": "deepseek-v4-pro", "language": "zh", ...}

event: agent_start
data: {"agent": "market_analyst", "label": "Market Analyst"}

event: agent_complete
data: {"agent": "market_analyst", "label": "...", "report": "<7000-char markdown>"}

event: debate_turn
data: {"phase": "investment", "speaker": "Bull Researcher", "content": "...", "round": 0}

event: final
data: {"decision": "**Rating**: Hold ...", "trader_plan": "**Action**: Hold ..."}

# both:
event: done
data: {"input_tokens": 33050, "output_tokens": 2009, "cost_usd": 0.0104, ...}

# on failure (HTTP is still 200, error is in-band):
event: error
data: {"message": "DEEPSEEK_API_KEY not configured on server"}
```

Frontend dispatches by `event:` name. JSON parse failure leaves data as raw
string (defensive — backend always sends JSON in our case).

---

## 6. Cost & gating

| Mode | Tokens / run | Cost (V4 fresh) | Cost (V4 cache hit) |
|---|---|---|---|
| Quick | ~33k in, ~2k out | $0.005 | $0.002 |
| Debate | ~150k in (over 10-15 calls), ~5k out | $0.20 | $0.10 |

Daily $ cap (default $10) is enforced via Redis counter keyed by UTC date,
TTL 36 h (clears 1 day later). Per-IP rate limits default to 5 quick / hour
and 1 debate / hour — generous enough for friends, miser enough to survive
casual abuse.

If a request would exceed the daily cap, route returns HTTP 429 *before*
opening the SSE stream — cheaper than starting and aborting mid-flight.

---

## 7. Two-stage public deployment

### Stage A — IP-only soft launch

- Buy 2c4g VPS in a Chinese region (Aliyun / Tencent / Volcengine), Ubuntu 22.04, ¥99-200/year first-year discount.
- Open inbound TCP **8080** (port 80 is blocked by Chinese ISPs for unfiled domains).
- `git clone` (or scp) the repo, `sudo bash deploy/setup-server.sh` once, then `sudo bash deploy/install.sh` after every code update.
- URL: `http://<ip>:8080` — works, but browsers show "Not Secure" warning, and the cloud provider may flag the IP for unfiled access after 7-30 days.

### Stage B — domain + ICP + HTTPS

- Register `your.domain` with the same provider's registrar (¥55-89/year), submit ICP filing under your name.
- **Critical**: write the site description as "AI 多 agent 系统技术演示" *not* "投资分析" — the latter triggers a financial-services license demand and rejects the filing.
- Filing takes 14-21 days. After approval:
  - Point A record to VPS IP, open inbound 443.
  - `sudo certbot --nginx -d your.domain` — adds SSL block + http→https redirect to the nginx site.
  - Update `.env`: `PUBLIC_API_BASE=https://your.domain`.
  - `sudo bash deploy/install.sh` rebuilds the frontend with the new base URL baked in.

---

## 8. What was tried and abandoned

A timeline of detours so we don't repeat them:

1. **slowapi standard `@limiter.limit(...)` decorator** → typoed tickers burned quota because the decorator runs at handler entry. Replaced with custom sliding-window limiter called *after* `get_snapshot()` succeeds.
2. **`llm_provider="openai"` + manual `backend_url=https://api.deepseek.com`** → langchain_openai's new code defaults to OpenAI's `/v1/responses` Responses API, which DeepSeek doesn't implement → 404. Solved by using TradingAgents' built-in `llm_provider="deepseek"` (which routes to the OpenAI-compatible `/v1/chat/completions` endpoint).
3. **`stream_mode="updates"` assumed** for LangGraph (chunks = node deltas). Reality: TradingAgents uses `"values"` (each chunk = full state snapshot). Translation layer rewritten to diff successive snapshots.
4. **`sse_starlette.EventSourceResponse(yield "event: ...\ndata: ...\n\n")`** double-wrapped frames. Fix: yield `dict` and let EventSourceResponse format it.
5. **Original Plan: Anthropic API + Vercel + Railway**. Pivoted to DeepSeek + bare-metal China VPS once user constraints were clarified (cost, audience, network).
6. **Initial Docker compose plan** with backend / redis / frontend-nginx as separate services. Replaced with bare systemd to save RAM and simplify debug.

---

## 9. Open work

Not done in this iteration but plausibly next:

- **CN data on production VPS** — local dev hit a proxy issue with akshare's eastmoney endpoint; needs verification on a clean Chinese VPS.
- **Caddy instead of nginx** for Stage B — would auto-provision Let's Encrypt without certbot. Currently the `install.sh` doesn't handle 443; certbot does it as a one-off.
- **Persistent run history** — currently fire-and-forget. Could store `(ticker, mode, output, timestamp)` in SQLite for share-links.
- **Skill expansion** — `serenity-skill` (industry-chain research) was identified during exploration as cleanly portable to API mode; not yet wired into a route.
- **Test suite** — there is no unit/integration test directory. We relied on hand-driven smoke tests during dev.
