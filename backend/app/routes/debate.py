"""POST /api/debate — multi-agent TradingAgents debate over SSE."""
from __future__ import annotations

import logging
from os import getenv
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.config import get_settings
from app.services import auth, budget, events, reports
from app.services.market_data import get_snapshot
from app.services.rate_limit import enforce_scope
from app.services.tradingagents_runner import sse_event, stream_debate

log = logging.getLogger(__name__)

router = APIRouter()

ALLOWED_ANALYSTS = {"market", "news", "fundamentals", "social"}


def _assemble_debate_md(
    ticker: str,
    language: str,
    final_decision: str,
    trader_plan: str,
    agent_reports: list[tuple[str, str]],
) -> str:
    """Flatten the streamed debate into a single markdown document for storage."""
    zh = language == "zh"
    parts = [f"# {ticker} — {'多智能体辩论报告' if zh else 'Multi-Agent Debate Report'}"]
    if final_decision:
        parts.append(f"## {'最终决策' if zh else 'Final Decision'}\n\n{final_decision}")
    if trader_plan:
        parts.append(f"## {'交易计划' if zh else 'Trader Plan'}\n\n{trader_plan}")
    for label, report in agent_reports:
        if report:
            parts.append(f"## {label}\n\n{report}")
    return "\n\n".join(parts)


class DebateRequest(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=16)
    market: Literal["US", "CN", "HK"] = "US"
    trade_date: str | None = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    analysts: list[str] = Field(default_factory=lambda: ["market", "news", "fundamentals"])
    language: Literal["en", "zh"] = "en"


@router.post("/debate")
async def debate(request: Request, req: DebateRequest) -> EventSourceResponse:
    settings = get_settings()

    bad = [a for a in req.analysts if a not in ALLOWED_ANALYSTS]
    if bad:
        raise HTTPException(status_code=400, detail=f"unknown analyst(s): {bad}")
    if not req.analysts:
        raise HTTPException(status_code=400, detail="analysts list cannot be empty")

    # Snapshot pre-fetch — fail-fast on bad ticker before counting toward
    # the rate-limit quota.
    try:
        snapshot = get_snapshot(req.ticker, req.market)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        log.exception("snapshot pre-fetch failed for %s/%s", req.ticker, req.market)
        raise HTTPException(status_code=502, detail=f"upstream data error: {e}") from e

    # Debate is capped per account for signed-in users (admin-editable), per IP
    # for anonymous — resolve the user first so the right cap applies.
    user = auth.user_from_request(request)
    enforce_scope(request, "debate", user)
    budget.assert_within_budget()

    async def event_gen():
        # Push the snapshot first so the frontend can render the chart while
        # TradingAgents spins up.
        yield sse_event("snapshot", snapshot.model_dump())
        # Conservative cost estimate to charge against the budget. The exact
        # per-token cost is impractical to compute here (no usage in stream),
        # so we charge a flat estimate at run end. With deep_think_llm=v4-pro
        # and quick_think_llm=v4-flash, ~10-15 LLM calls per run lands around
        # $0.25; tune via env var if real spend drifts.
        flat_cost = float(getenv("TRADINGAGENTS_DEBATE_COST_USD", "0.25"))
        agent_reports: list[tuple[str, str]] = []
        final_decision = ""
        trader_plan = ""
        try:
            async for event_name, payload in stream_debate(
                ticker=req.ticker,
                market=req.market,
                trade_date=req.trade_date,
                analysts=req.analysts,
                language=req.language,
            ):
                if event_name == "agent_complete":
                    agent_reports.append((payload.get("label", ""), payload.get("report", "")))
                elif event_name == "final":
                    final_decision = payload.get("decision", "") or ""
                    trader_plan = payload.get("trader_plan", "") or ""
                elif event_name == "done":
                    new_total = budget.add_cost(flat_cost)
                    payload["est_cost_usd"] = flat_cost
                    payload["budget_today_usd"] = round(new_total, 6)
                    events.record_run(request, mode="debate", ticker=req.ticker,
                                      market=req.market, cost_usd=flat_cost)
                    if user and (final_decision or agent_reports):
                        try:
                            content = _assemble_debate_md(
                                req.ticker, req.language, final_decision, trader_plan, agent_reports
                            )
                            meta = reports.save_report(
                                user.id,
                                ticker=req.ticker,
                                market=req.market,
                                mode="debate",
                                language=req.language,
                                content=content,
                                decision=reports.extract_signal(final_decision),
                                cost_usd=flat_cost,
                            )
                            payload["saved_report_id"] = meta.id
                        except Exception:
                            log.exception("save debate report failed")
                yield sse_event(event_name, payload)
        except Exception as e:
            log.exception("debate stream failed")
            yield sse_event("error", {"message": str(e)})

    return EventSourceResponse(event_gen())
