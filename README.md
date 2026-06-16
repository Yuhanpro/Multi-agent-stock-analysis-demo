# stock-web

Interactive multi-agent stock analysis demo. Pick a ticker, watch the agents
argue. Powered by **DeepSeek V4** + the **TradingAgents** multi-agent
framework + a Buffett-style value-investing skill.

> **Research demo.** Not investment advice. The site exists to show what's
> possible when you wire production-quality LLM agent frameworks into a
> public-facing UI — not to recommend trades.

---

## What it does

Three modes share the same ticker input (US equities via yfinance, A-shares
via akshare):

| Mode | Pipeline | Latency | Cost / run |
|---|---|---|---|
| **Snapshot** | yfinance / akshare → JSON | ~1 s | $0 |
| **Buffett Quick** | snapshot + 158k-char Buffett skill prompt → DeepSeek V4-Flash | ~30 s | ~$0.01 |
| **TradingAgents Debate** | LangGraph multi-agent: market / news / fundamentals analysts → bull-vs-bear → trader → 4-agent risk debate → final decision | 3-5 min | ~$0.20-0.30 |

The frontend renders all three over Server-Sent Events:

- Quick streams **token-by-token** like ChatGPT
- Debate streams **agent-by-agent**: each analyst card lights up as it
  finishes, then bull/bear/risk turns appear in a timeline, then a hero
  verdict card with extracted price target / stop loss / position sizing

Bilingual (English + 简体中文) — switch in the top-right; all agent
output is generated in the chosen language at the LLM layer (not translated
post-hoc).

---

## Stack

```
[Browser] ──HTTPS/SSE──→ [nginx] ──→ [FastAPI] ──→ DeepSeek V4 API
                            │            │
                            │            ├─→ TradingAgents (LangGraph)
                            │            ├─→ yfinance / akshare
                            │            └─→ Redis (rate limits + daily budget)
                            │
                            └─→ static Next.js export (frontend)
```

- **Backend** — FastAPI + uv-managed Python 3.12. Streams SSE via
  `sse-starlette`. The 158k-char Buffett system prompt is loaded once and
  reused (DeepSeek context cache drops repeat-call cost ~3x). TradingAgents
  is vendored locally (see `backend/vendor/README.md`).
- **Frontend** — Next.js 14 App Router + Tailwind 3 + recharts. `output: "export"`
  produces static HTML/JS — no Node process at runtime.
- **Deployment** — bare systemd on a single Linux VPS, no Docker. See
  [DEPLOY.md](./DEPLOY.md).

---

## Local development

### One-time setup

```powershell
# 1. clone TradingAgents and put it next to this repo
#    (the backend pyproject.toml expects ./vendor/TradingAgents)
git clone https://github.com/<TradingAgents-upstream>/TradingAgents.git
cd stock-web/backend
robocopy ..\..\TradingAgents vendor\TradingAgents /E `
    /XD .git .venv __pycache__ logs cache `
    /XF *.pyc .env

# 2. install backend deps (Python 3.12 required)
uv sync

# 3. install frontend deps (Node 20+ required)
cd ..\frontend
npm install
```

### Run

Two terminals:

```powershell
# Terminal 1 — backend
cd stock-web\backend
$env:DEEPSEEK_API_KEY = "sk-..."
uv run uvicorn app.main:app --port 8000 --reload

# Terminal 2 — frontend
cd stock-web\frontend
npm run dev
```

Browser → http://localhost:3000

### Get a DeepSeek API key

[platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys) — quick analysis costs ~$0.01/run, debate ~$0.20-0.30/run.

---

## Layout

```
stock-web/
├── backend/                       # FastAPI + Python 3.12 (uv-managed)
│   ├── app/
│   │   ├── main.py                # FastAPI app, CORS, /healthz
│   │   ├── config.py              # env loader (Settings dataclass)
│   │   ├── routes/
│   │   │   ├── snapshot.py        # GET  /api/snapshot
│   │   │   ├── quick.py           # POST /api/quick   (SSE)
│   │   │   └── debate.py          # POST /api/debate  (SSE)
│   │   ├── services/
│   │   │   ├── market_data.py     # yfinance + akshare
│   │   │   ├── skill_runner.py    # buffett skill → DeepSeek streaming
│   │   │   ├── tradingagents_runner.py  # LangGraph stream → SSE events
│   │   │   ├── rate_limit.py      # per-IP sliding window
│   │   │   └── budget.py          # daily $ cap (Redis or in-memory)
│   │   └── prompts/buffett/       # SKILL.md + 8 reference files
│   ├── vendor/                    # TradingAgents source (gitignored)
│   └── pyproject.toml             # path-dep on vendor/TradingAgents
│
├── frontend/                      # Next.js 14 (App Router)
│   ├── app/
│   │   ├── layout.tsx             # I18nProvider wrap
│   │   └── page.tsx               # mode selector + state machine
│   ├── components/
│   │   ├── stock-input.tsx        # US/CN toggle + ticker
│   │   ├── snapshot-card.tsx      # K-line chart + 6 fundamental stats
│   │   ├── quick-result.tsx       # token-streaming markdown
│   │   ├── debate-stream.tsx      # agent timeline + hero verdict card
│   │   └── language-switcher.tsx  # EN / 中文
│   └── lib/
│       ├── sse.ts                 # SSE-over-POST client (fetch+ReadableStream)
│       ├── i18n.tsx               # Context + dict (no i18next; ~150 keys)
│       ├── api.ts                 # fetch wrapper, NEXT_PUBLIC_API_BASE
│       └── format.ts              # number/pct/price formatters + cn()
│
├── deploy/                        # systemd + nginx for production
│   ├── setup-server.sh            # one-time bootstrap on a fresh VPS
│   ├── install.sh                 # idempotent deploy / redeploy
│   ├── stock-web-backend.service  # systemd unit, hardened
│   └── nginx.conf                 # SSE-tuned reverse proxy
│
├── docs/
│   ├── PLAN.md                    # full design / architecture / what we tried
│   └── SKILL.md                   # Claude Code skill for continuing work
│
├── DEPLOY.md                      # step-by-step deploy + ICP filing notes
└── README.md                      # this file
```

---

## Notable design choices

- **No Docker.** systemd + nginx + uv direct. Saves ~250 MB of memory on
  small VPS, simpler to debug (`journalctl` vs `docker logs`), no daemon
  to babysit. The trade-off (less environment isolation) doesn't matter
  on a single-tenant demo box.
- **SSE-over-POST.** Browser `EventSource` is GET-only; we hand-parse
  `event:` / `data:` frames in `frontend/lib/sse.ts` so `/api/quick` and
  `/api/debate` can take JSON bodies. Tuned nginx timeouts and disabled
  buffering — debate runs ~5 min and would otherwise hit the default 60 s
  proxy_read_timeout.
- **Rate limiter runs *after* validation.** slowapi's decorator runs at
  handler entry, so a typo'd ticker would burn quota; we use a custom
  sliding-window limiter called explicitly *after* the snapshot pre-fetch
  succeeds.
- **TradingAgents stream mode.** LangGraph emits full state snapshots
  (`stream_mode="values"`), not deltas. The runner diffs successive chunks
  to detect "agent N just filled in `market_report`" → emits `agent_complete`
  SSE event. Streaming granularity is per-agent, not per-token, since the
  graph blocks on each agent's full LLM run.
- **Buffett skill loaded as one giant system prompt.** SKILL.md +
  references/*.md totals 158k chars. Inlined at boot; DeepSeek's implicit
  context cache makes repeat calls ~3x cheaper.

---

## What's *not* in the box

- No user accounts. Per-IP rate limits + global daily $ budget cap stop
  abuse without forcing signup.
- No history / saved analyses. Fire and forget.
- No backtesting. The output is qualitative analysis, not a tradeable signal.
- No streaming for `quick` after the first ~30 chars on a cache miss
  (DeepSeek's first-token latency).

---

## Work log

Reverse-chronological. New entries on top. Each entry: date · what shipped · what blocked.

### 2026-06-16 — initial 9-task buildout

What shipped (all 9 tasks ✅):

1. **Repo scaffolding** — `backend/` (uv + Python 3.12), `frontend/` (Next 14), `.gitignore`, README. Verified `uv sync` resolves the path-dep on `vendor/TradingAgents`.
2. **Backend skeleton + snapshot route** — FastAPI app, CORS, `/healthz`, `market_data.py` unifying yfinance + akshare, `GET /api/snapshot`. Caught + fixed yfinance NaN tail-row bug (current trading day occasionally null).
3. **Skill runner + `/api/quick` SSE** — vendored Buffett skill (`SKILL.md` + 8 references = 157k char system prompt). DeepSeek streaming via OpenAI SDK + `base_url`. Caught + fixed sse-starlette double `data:` wrap (yield dict, not pre-formatted string).
4. **TradingAgents runner + `/api/debate` SSE** — LangGraph `stream_mode="values"` translation layer. Diffs successive state snapshots to emit `agent_start / agent_complete / debate_turn / final / done`. Async-wraps the sync `graph.stream()` via `asyncio.Queue + run_in_executor`. **Discovered**: `llm_provider="openai" + backend_url=deepseek` triggers OpenAI Responses API → 404. Fixed by using TA's built-in `llm_provider="deepseek"`.
5. **Rate limit + daily budget gate** — replaced slowapi (decorator runs before validation, typoed tickers burn quota) with custom sliding-window limiter called *after* snapshot pre-fetch. Redis backend (atomic INCR + EXPIRE NX) with in-memory fallback for local dev. Daily $ cap enforced before SSE opens.
6. **Frontend skeleton** — Next 14 App Router, Tailwind 3 (deep-blue theme later), shadcn-ish components, recharts K-line, mode selector (snapshot / quick / debate). Verified static export builds and `NEXT_PUBLIC_API_BASE` bakes into the bundle.
7. **SSE client + UI streaming** — hand-rolled `lib/sse.ts` (`fetch + ReadableStream`, CRLF-tolerant frame parser) since `EventSource` is GET-only. `quick-result.tsx` token-streams markdown like ChatGPT; `debate-stream.tsx` renders agent timeline with collapsible cards. Hero "Final Decision" card extracts BUY/SELL/HOLD verdict, TL;DR sentence (regex over `Executive Summary` / `执行摘要` / `Reasoning` / `理由`), and key facts (price target, stop loss, time horizon, position sizing) lifted into pills.
8. **Local end-to-end verification** — three real LLM runs: Quick zh AAPL ($0.005, 29 s), Quick en NVDA ($0.005, 36 s), Debate zh AAPL ($0.10, 273 s, 31 chunks, 0 errors). Total ~$0.11. Verified language switching produces 100% Chinese / 100% English with no cross-contamination.
9. **Deploy scaffolding** — initially Docker compose, **pivoted to bare systemd + nginx + uv on Ubuntu** (saves ~250 MB RAM, no daemon, simpler `journalctl` debugging). Wrote `deploy/setup-server.sh`, `deploy/install.sh`, `deploy/stock-web-backend.service`, `deploy/nginx.conf`, `DEPLOY.md` with two-stage rollout (IP soft-launch → ICP + HTTPS). Verified backend imports under new vendor path and `npm run build` static export succeeds with API base baked in.

Other notable choices made today:

- **DeepSeek V4** (not V3 — that's a misread of the legacy alias `deepseek-chat` which now maps to V4-Flash; aliases retire 2026-07-24). Default split: V4-Pro for debate deep-think, V4-Flash for quick + TA internal calls.
- **Deep-blue theme** with subtle radial accent at the top (deeper finance/analytics vibe than the original neutral grey).
- **EN / 中文 i18n** via flat dict in `lib/i18n.tsx` (~150 keys, no i18next). Persists in localStorage; first visit sniffs `navigator.language`. LLM output language passed through to backend (Quick uses tail directive, Debate uses TradingAgents' built-in `output_language="Chinese"`).
- **Why not Vercel + Railway** — mainland China connectivity is poor; demo audience is friends without VPNs.

Blockers / open from today:

- akshare's eastmoney endpoint fails locally because of an HTTP proxy on this machine — needs verification on a clean Chinese VPS in production.
- ICP filing not started — domain + 14-21 day filing process is on the user. Stage A (IP-only `:8080`) deploys without it.
- No automated test suite. Smoke-tested by hand throughout.
- No live demo URL yet. Will be added once Stage A deploys to a real VPS.

---

## License

MIT. TradingAgents has its own license — check before redistributing.
