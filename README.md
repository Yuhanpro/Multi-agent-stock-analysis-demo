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

## License

MIT. TradingAgents has its own license — check before redistributing.
