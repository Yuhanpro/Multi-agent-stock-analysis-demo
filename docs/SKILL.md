---
name: stock-web
description: |
  Codebase orientation skill for the stock-web repo — a public-demo wrapper
  around TradingAgents (multi-agent LangGraph debate) and a Buffett value-
  investing skill, served via FastAPI + Next.js with SSE streaming, deployed
  bare-metal to a Chinese VPS. Trigger this skill when working on any file
  under stock-web/, when answering questions about the architecture, or
  when continuing the project's open work (new analysis modes, deployment
  steps, frontend redesigns). Surfaces: what each module does, why it does
  it that way, where the gotchas are, and what was already considered and
  rejected.
---

# stock-web codebase skill

## Quick orientation

This is a **single-VPS public demo** that:

1. Takes a stock ticker (US via yfinance, A-shares via akshare)
2. Runs one of three analyses:
   - **Snapshot** — pure data, no LLM
   - **Quick** — Buffett skill prompt → DeepSeek V4-Flash, token-streamed
   - **Debate** — TradingAgents (LangGraph multi-agent) → DeepSeek V4-Pro,
     agent-by-agent streamed
3. Streams results to a Next.js (statically exported) frontend over SSE

**Stack pin**: Python 3.12 + uv, Node 20+, DeepSeek V4 (NOT V3),
TradingAgents vendored at `backend/vendor/TradingAgents/` (gitignored —
clone separately when bootstrapping).

Don't reach for these reflexively:
- ❌ Docker (bare systemd intentional — see PLAN.md §8)
- ❌ slowapi `@limit(...)` decorator (typo'd tickers would burn quota)
- ❌ `EventSource` (POST endpoints, must hand-parse SSE)
- ❌ Anthropic / OpenAI as the LLM (DeepSeek deliberately, mainland-friendly)
- ❌ Railway / Vercel (mainland China connectivity is poor)

---

## When you start working

Before editing anything, do this:

1. **Read [docs/PLAN.md](../PLAN.md)** — full design record. The §8 "tried
   and abandoned" list is critical; it's full of dead ends future you would
   otherwise re-explore.
2. **Skim [README.md](../../README.md)** — user-facing summary + repo layout.
3. **Verify the workspace**:
   ```powershell
   cd stock-web/backend; uv sync   # backend deps + path-dep tradingagents
   cd ../frontend; npm install
   ```
   If `uv sync` complains about `vendor/TradingAgents` missing, clone
   TradingAgents from upstream and follow `backend/vendor/README.md`.

---

## File-by-file index

### Backend (`backend/app/`)

| File | What | Why |
|---|---|---|
| `main.py` | FastAPI app, CORS middleware, `/healthz` | `healthz` exposes `has_deepseek_key`, `budget`, `rate_limits` for observability |
| `config.py` | Single `Settings` dataclass, frozen, cached | Read once at boot from env vars, no runtime reload |
| `routes/snapshot.py` | `GET /api/snapshot?ticker=&market=` | Synchronous, no LLM, returns `Snapshot` JSON |
| `routes/quick.py` | `POST /api/quick` (SSE) | Pre-fetches snapshot → rate limit → budget → opens SSE → streams via `skill_runner` |
| `routes/debate.py` | `POST /api/debate` (SSE) | Same gating; drives `tradingagents_runner` |
| `services/market_data.py` | yfinance + akshare wrapper, Pydantic schemas | Drops trailing NaN OHLCV rows (yfinance current-day quirk) |
| `services/skill_runner.py` | Loads `prompts/buffett/` once → DeepSeek streaming | Inlines all 8 references into one 158k-char system prompt |
| `services/tradingagents_runner.py` | LangGraph stream → SSE event translator | Diffs `stream_mode="values"` snapshots to detect agent completion |
| `services/rate_limit.py` | Per-IP sliding window, Redis or in-memory | `check_and_count()` called *after* validation, not in decorator |
| `services/budget.py` | Daily $ cap by UTC date | `assert_within_budget()` raises 429; `add_cost()` debits at `done` |
| `prompts/buffett/SKILL.md` + `references/*.md` | The actual skill content | Vendored from `~/.claude/skills/buffett/`; references inlined at boot, not loaded on demand |

### Frontend (`frontend/`)

| File | What | Why |
|---|---|---|
| `app/layout.tsx` | Wraps `<I18nProvider>` | Forces `dark` class on `<html>` |
| `app/page.tsx` | Main state machine | Mode selector → ticker input → snapshot fetch → mounts Quick or Debate via `key={runId}` (forces remount on re-run) |
| `components/stock-input.tsx` | US/CN toggle + ticker | Default AAPL; placeholder localized |
| `components/snapshot-card.tsx` | K-line + 6 fundamentals | recharts AreaChart, gradient fill colored by change_pct sign |
| `components/quick-result.tsx` | Token-streaming markdown | `react-markdown + remark-gfm`, animated cursor while in-flight |
| `components/debate-stream.tsx` | Agent timeline + final hero card | Three sections (analyst grid, investment debate, risk debate, final). `FinalCard` extracts BUY/SELL/HOLD verdict, TL;DR sentence, and key facts (price target, stop, position) |
| `components/language-switcher.tsx` | EN / 中文 toggle | Persists to localStorage |
| `lib/sse.ts` | `streamSSE(path, body, handlers)` | `fetch + ReadableStream + TextDecoder`, parses CRLF-tolerant SSE frames |
| `lib/i18n.tsx` | Context + flat dict (~150 keys) | No i18next dep; `useT()` returns `t(key)` |
| `lib/api.ts` | `fetchSnapshot()`, types | `API_BASE` from `NEXT_PUBLIC_API_BASE` env (baked at build) |
| `lib/format.ts` | `fmtNumber/fmtPct/fmtPrice/cn()` | Currency-symbol selection (¥/$) by snapshot.fundamentals.currency |

### Deploy (`deploy/`)

| File | What |
|---|---|
| `setup-server.sh` | One-time VPS bootstrap (apt installs, redis enable, stockweb user) |
| `install.sh` | Idempotent deploy (uv sync, systemd, npm build, rsync, nginx reload, healthz check) |
| `stock-web-backend.service` | systemd unit, hardened (`NoNewPrivileges`, `ProtectSystem=strict`, `MemoryMax=2G`) |
| `nginx.conf` | listens :8080, static root, `/api/*` reverse proxy with SSE-tuned settings |

---

## Common tasks

### Add a new analysis mode

Want a third LLM-powered mode (e.g. "DCF valuation")?

1. **Backend**: write `app/services/<your>_runner.py` (mirror `skill_runner.py`)
   that yields `(event_name, data)` tuples. Add `app/routes/<your>.py` route
   following `quick.py` template (snapshot pre-fetch → `check_and_count` →
   `assert_within_budget` → SSE).
2. **Register** in `app/main.py`: `app.include_router(...)`.
3. **Frontend**: copy `components/quick-result.tsx`, adapt event handling.
   Add a mode entry to `MODE_DEFS` array in `app/page.tsx`.
4. **i18n**: add labels in `lib/i18n.tsx` for both `en` and `zh`.

### Pull TradingAgents upstream changes

```powershell
cd backend
robocopy ..\..\TradingAgents vendor\TradingAgents /MIR `
    /XD .git .venv __pycache__ logs cache `
    /XF *.pyc .env .env.enterprise.example
# verify no .env leaked:
Get-ChildItem vendor\TradingAgents -Recurse -Filter ".env*" -Force
# should print only .env.example
```

Then `uv sync` and re-test debate.

### Update the Buffett skill

The skill in `backend/app/prompts/buffett/` is a snapshot. To resync from
your live `~/.claude/skills/buffett/`:

```powershell
$src = "$HOME\.claude\skills\buffett"
$dst = "C:\Users\fuyuh\projects\stock-web\backend\app\prompts\buffett"
Copy-Item "$src\SKILL.md" "$dst\SKILL.md" -Force
Copy-Item "$src\references\*.md" "$dst\references\" -Force
```

`skill_runner.py` strips frontmatter and prepends the API Mode Adapter on load.

### Change a model id

Set `DEEP_THINK_LLM` and/or `QUICK_THINK_LLM` in the env. **Update
`PRICING` table in `app/services/skill_runner.py`** so `cost_usd` in the
`done` event remains accurate.

### Tune rate limits

Set `RATE_LIMIT_QUICK` and `RATE_LIMIT_DEBATE` in the env. Format is
`<N>/<period>` where period ∈ `second/minute/hour/day`. The limiter
auto-parses; no code change needed.

---

## Gotchas (read before debugging)

- **`/api/quick` and `/api/debate` are POST**. `EventSource` won't work — use
  `lib/sse.ts` (`fetch` + `ReadableStream`).
- **TradingAgents uses `stream_mode="values"`**, not `"updates"`. Each
  chunk is a full snapshot; we diff them. Do NOT switch the stream mode
  without rewriting the runner.
- **DeepSeek API doesn't implement OpenAI's `/v1/responses`**. Use
  TradingAgents' built-in `llm_provider="deepseek"` — it picks
  `DeepSeekChatOpenAI` and the right `/v1/chat/completions` endpoint
  automatically.
- **Don't yield pre-formatted SSE strings to `sse_starlette.EventSourceResponse`** —
  it'll double-wrap with `data:`. Yield `dict({"event":..., "data":...})`.
- **yfinance occasionally returns NaN for the current trading day's
  Close**. `market_data.py` filters them; if you change that code, keep
  the `if row["Close"] == row["Close"]` guard.
- **slowapi was tried and rejected**. Don't add `@limiter.limit(...)` decorators —
  use `check_and_count(request, scope, limit)` from `services/rate_limit.py`
  *after* validation succeeds.
- **Buffett skill references must be inlined**, not loaded by tool. The
  `API Mode Adapter` preamble in `skill_runner.py` tells the model "no
  Read tool — references are inlined below". Don't remove it.
- **Frontend `NEXT_PUBLIC_API_BASE` is baked at build time**, not runtime.
  Changing the production URL requires `npm run build` (or rerunning
  `deploy/install.sh`).
- **nginx SSE timeouts must stay ≥ 600 s** for debate. Default 60 s would
  cut a 5-minute run in half.
- **akshare may not work on境外 VPS** — eastmoney endpoint sometimes
  blocks non-CN IPs. If A-shares fail in production but US works, this
  is the cause. Stage A on a Chinese VPS sidesteps the issue.

---

## Open work (in priority order)

From `docs/PLAN.md §9`:

1. **Verify CN data on a clean Chinese VPS** — local dev hit a proxy issue
   with akshare; production may behave differently.
2. **Caddy + auto-Let's Encrypt for Stage B** — would replace the
   certbot-on-nginx step with declarative config.
3. **Persistent run history** in SQLite for share-links.
4. **Wire `serenity-skill` as a fourth mode** (industry-chain research) —
   identified during exploration as cleanly portable to API mode.
5. **Test suite** — currently zero. Add pytest for `services/` + Playwright
   for the frontend.

---

## Pointers to live state

- LLM cost / budget snapshot: `curl http://<host>/healthz | jq .budget`
- Backend logs (production): `journalctl -u stock-web-backend -f`
- DeepSeek pricing source: https://api-docs.deepseek.com/quick_start/pricing
- TradingAgents upstream: see `backend/vendor/README.md` for the path you
  vendored from.
