"""tradingagents_runner — multi-agent debate via LangGraph stream.

LangGraph runs TradingAgents with stream_mode="values": every chunk is a full
state snapshot, not a delta. We diff successive chunks to detect "an agent
just finished" and emit `agent_complete` SSE events with the report it filled.

Streaming granularity is milestone-level (per agent), NOT token-level — the
graph blocks on each agent's full LLM run before yielding. The frontend
should render each agent_complete event as a card that fades in.

SSE event types yielded by `stream_debate`:
  meta            — once at start: ticker, model, analysts, run config
  agent_start     — when graph enters a new agent (heuristic: state field
                    is still empty, but graph activity suggests current agent)
  agent_complete  — when an agent's report field flips from empty to filled
  state           — investment / risk debate-state transitions (round, speaker)
  final           — final trade decision + processed summary
  done            — totals (chunks, elapsed, est cost)
  error           — terminal upstream error
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from datetime import datetime
from typing import AsyncIterator, Literal

from app.config import get_settings

log = logging.getLogger(__name__)

# Map state-field names to display labels + ordering. Order matters: the UI
# renders cards in this order so agents appear top-to-bottom even if the
# graph yields them slightly out of sequence.
AGENT_FIELDS = [
    ("market_report",       "market_analyst",       "Market Analyst"),
    ("sentiment_report",    "sentiment_analyst",    "Sentiment Analyst"),
    ("news_report",         "news_analyst",         "News Analyst"),
    ("fundamentals_report", "fundamentals_analyst", "Fundamentals Analyst"),
]

# DeepSeek pricing copy (USD per 1M tokens, Jun 2026).
PRICING = {
    "deepseek-chat":     {"input": 0.27, "output": 1.10},
    "deepseek-reasoner": {"input": 0.55, "output": 2.19},
}


def _coerce_messages_count(state: dict) -> int:
    """Length of the langgraph messages list, used as a 'graph progressed' signal."""
    msgs = state.get("messages") or []
    return len(msgs) if isinstance(msgs, list) else 0


def _filled(value) -> bool:
    """True if a state field has non-empty content."""
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return bool(value)


def _diff_debate_state(prev: dict, curr: dict, key: str) -> list[dict]:
    """Compare investment_debate_state / risk_debate_state across chunks.

    Yields {speaker, content} entries for newly-completed turns.
    """
    p = (prev or {}).get(key) or {}
    c = (curr or {}).get(key) or {}
    events = []

    if key == "investment_debate_state":
        for speaker_field, speaker_label in [
            ("bull_history",  "Bull Researcher"),
            ("bear_history",  "Bear Researcher"),
            ("judge_decision", "Research Manager"),
        ]:
            pv = (p.get(speaker_field) or "").strip()
            cv = (c.get(speaker_field) or "").strip()
            if cv and cv != pv:
                # bull_history / bear_history accumulate across rounds; emit
                # only the newly-appended portion.
                if pv and cv.startswith(pv):
                    new = cv[len(pv):].strip()
                else:
                    new = cv
                if new:
                    events.append({"speaker": speaker_label, "content": new,
                                   "round": int(c.get("count") or 0)})
    elif key == "risk_debate_state":
        for speaker_field, speaker_label in [
            ("aggressive_history",   "Aggressive Risk"),
            ("conservative_history", "Conservative Risk"),
            ("neutral_history",      "Neutral Risk"),
            ("judge_decision",       "Risk Manager"),
        ]:
            pv = (p.get(speaker_field) or "").strip()
            cv = (c.get(speaker_field) or "").strip()
            if cv and cv != pv:
                if pv and cv.startswith(pv):
                    new = cv[len(pv):].strip()
                else:
                    new = cv
                if new:
                    events.append({"speaker": speaker_label, "content": new,
                                   "round": int(c.get("count") or 0)})
    return events


def _build_config(analysts: list[str], settings, language: str = "en") -> dict:
    """Build the TradingAgents config dict. Imported lazily to keep cold-start
    fast for routes that don't use TA.

    `language` is the API-facing 2-letter code; we map it to the full names
    TradingAgents' internal prompt template expects (it injects "Write your
    entire response in <lang>." into each agent system prompt).
    """
    from tradingagents.default_config import DEFAULT_CONFIG
    output_language = "Chinese" if (language or "en").lower().startswith("zh") else "English"
    cfg = dict(DEFAULT_CONFIG)
    cfg.update({
        "llm_provider":          "deepseek",      # built-in DeepSeek client
        "deep_think_llm":        settings.deep_think_llm,
        "quick_think_llm":       settings.quick_think_llm,
        "max_debate_rounds":     1,
        "max_risk_discuss_rounds": 1,
        "output_language":       output_language,
        "online_tools":          True,
    })
    return cfg


def _ensure_deepseek_env(settings) -> None:
    """The TradingAgents deepseek client reads DEEPSEEK_API_KEY directly. Mirror
    the FastAPI-config value into the process env if not already set."""
    if not os.environ.get("DEEPSEEK_API_KEY") and settings.deepseek_api_key:
        os.environ["DEEPSEEK_API_KEY"] = settings.deepseek_api_key


async def stream_debate(
    *,
    ticker: str,
    market: str = "US",
    trade_date: str | None = None,
    analysts: list[str] | None = None,
    language: str = "en",
) -> AsyncIterator[tuple[str, dict]]:
    """Drive TradingAgentsGraph.graph.stream() and translate to SSE events."""
    settings = get_settings()
    if not settings.deepseek_api_key:
        yield "error", {"message": "DEEPSEEK_API_KEY not configured on server"}
        return

    _ensure_deepseek_env(settings)
    analysts = analysts or ["market", "news", "fundamentals"]
    trade_date = trade_date or datetime.utcnow().strftime("%Y-%m-%d")

    yield "meta", {
        "ticker": ticker,
        "trade_date": trade_date,
        "analysts": analysts,
        "model": settings.deep_think_llm,
        "max_debate_rounds": 1,
        "language": language,
    }

    try:
        from tradingagents.graph.trading_graph import TradingAgentsGraph
    except Exception as e:
        log.exception("import TradingAgents failed")
        yield "error", {"message": f"failed to import TradingAgents: {e}"}
        return

    cfg = _build_config(analysts, settings, language=language)

    # Build graph in a worker thread — TradingAgentsGraph.__init__ does I/O
    # (loads memory store, sets up vector index) and we don't want to block
    # the event loop.
    try:
        graph = await asyncio.to_thread(
            TradingAgentsGraph,
            selected_analysts=analysts,
            debug=False,
            config=cfg,
        )
    except Exception as e:
        log.exception("TradingAgentsGraph init failed")
        yield "error", {"message": f"graph init failed: {e}"}
        return

    init_state = graph.propagator.create_initial_state(
        company_name=ticker,
        trade_date=trade_date,
    )
    args = graph.propagator.get_graph_args()

    # Inject our curated multi-period financials as an authoritative context
    # message. TradingAgents' own data tools are US-centric (weak for CN/HK), so
    # this gives every analyst (esp. fundamentals) reliable statements to cite.
    try:
        from app.services.financials import format_for_prompt, get_financials

        fin = await asyncio.to_thread(get_financials, ticker, market)
        block = format_for_prompt(fin)
        if block:
            zh = (language or "en").lower().startswith("zh")
            preface = (
                "以下为系统提供的权威多期财务数据(来自官方财报),分析时可直接引用,请勿臆造数字:\n\n"
                if zh else
                "Authoritative multi-period financial data provided by the system "
                "(from official filings) — cite directly, do not fabricate numbers:\n\n"
            )
            init_state["messages"].append(("human", preface + block))
    except Exception:
        log.warning("financials injection failed for %s/%s", ticker, market)

    # graph.stream() is a sync generator. Drain it on a thread, push chunks
    # into an asyncio.Queue, and consume here so we can yield SSE events
    # cooperatively without blocking the event loop on the LLM calls.
    queue: asyncio.Queue = asyncio.Queue(maxsize=2)
    SENTINEL = object()

    def producer():
        try:
            for chunk in graph.graph.stream(init_state, **args):
                # to_thread blocks the worker on blocking IO; the queue is
                # bounded so back-pressure flows naturally.
                asyncio.run_coroutine_threadsafe(queue.put(chunk), loop).result()
        except Exception as exc:  # pragma: no cover — surfaced via error event
            asyncio.run_coroutine_threadsafe(
                queue.put(("__error__", exc)), loop
            ).result()
        finally:
            asyncio.run_coroutine_threadsafe(queue.put(SENTINEL), loop).result()

    loop = asyncio.get_running_loop()
    producer_task = loop.run_in_executor(None, producer)

    prev: dict = {}
    started_agents: set[str] = set()
    completed_agents: set[str] = set()
    started_at = time.monotonic()
    chunk_count = 0
    final_state: dict | None = None

    try:
        while True:
            item = await queue.get()
            if item is SENTINEL:
                break
            if isinstance(item, tuple) and len(item) == 2 and item[0] == "__error__":
                log.exception("graph.stream raised", exc_info=item[1])
                yield "error", {"message": f"graph stream failed: {item[1]}"}
                return

            chunk: dict = item  # full state snapshot
            chunk_count += 1
            final_state = chunk

            # Heuristic agent_start: messages list grew but the agent's
            # report field is still empty.
            for field, agent_id, label in AGENT_FIELDS:
                if agent_id not in analysts and agent_id.replace("_analyst", "") not in analysts:
                    continue
                if agent_id in completed_agents or agent_id in started_agents:
                    continue
                if not _filled(chunk.get(field)) and _coerce_messages_count(chunk) > _coerce_messages_count(prev):
                    started_agents.add(agent_id)
                    yield "agent_start", {"agent": agent_id, "label": label}
                    break  # one start per chunk

            # agent_complete: report field flipped from empty to filled
            for field, agent_id, label in AGENT_FIELDS:
                if agent_id in completed_agents:
                    continue
                pv = prev.get(field)
                cv = chunk.get(field)
                if not _filled(pv) and _filled(cv):
                    completed_agents.add(agent_id)
                    if agent_id not in started_agents:
                        # never saw a start signal; emit one for UI consistency
                        yield "agent_start", {"agent": agent_id, "label": label}
                    yield "agent_complete", {
                        "agent": agent_id,
                        "label": label,
                        "report": cv,
                    }

            # investment_debate_state turns
            for evt in _diff_debate_state(prev, chunk, "investment_debate_state"):
                yield "debate_turn", {"phase": "investment", **evt}

            # risk_debate_state turns
            for evt in _diff_debate_state(prev, chunk, "risk_debate_state"):
                yield "debate_turn", {"phase": "risk", **evt}

            # final trade decision
            if not _filled(prev.get("final_trade_decision")) and _filled(chunk.get("final_trade_decision")):
                yield "final", {
                    "decision": chunk.get("final_trade_decision"),
                    "trader_plan": chunk.get("trader_investment_plan", ""),
                }

            prev = chunk
    finally:
        # Make sure the worker thread is reaped even on early exit
        try:
            await asyncio.wait_for(producer_task, timeout=5)
        except (asyncio.TimeoutError, Exception):
            pass

    elapsed = time.monotonic() - started_at
    yield "done", {
        "chunks": chunk_count,
        "elapsed_sec": round(elapsed, 1),
        "agents_completed": sorted(completed_agents),
        "model": settings.deep_think_llm,
    }


def sse_event(event: str, data: dict) -> dict:
    """Match skill_runner.sse_event so the SSE wire format is uniform."""
    return {"event": event, "data": json.dumps(data, ensure_ascii=False, default=str)}
