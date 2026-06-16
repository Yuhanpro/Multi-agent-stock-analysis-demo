"""POST /api/debate — multi-agent TradingAgents debate over SSE."""
from __future__ import annotations

import logging
from os import getenv
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.config import get_settings
from app.services import budget
from app.services.market_data import get_snapshot
from app.services.rate_limit import check_and_count
from app.services.tradingagents_runner import sse_event, stream_debate

log = logging.getLogger(__name__)

router = APIRouter()

ALLOWED_ANALYSTS = {"market", "news", "fundamentals", "social"}


class DebateRequest(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=16)
    market: Literal["US", "CN"] = "US"
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

    # Real request — count against per-IP quota and budget.
    check_and_count(request, scope="debate", limit=settings.rate_limit_debate)
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
        try:
            async for event_name, payload in stream_debate(
                ticker=req.ticker,
                trade_date=req.trade_date,
                analysts=req.analysts,
                language=req.language,
            ):
                if event_name == "done":
                    new_total = budget.add_cost(flat_cost)
                    payload["est_cost_usd"] = flat_cost
                    payload["budget_today_usd"] = round(new_total, 6)
                yield sse_event(event_name, payload)
        except Exception as e:
            log.exception("debate stream failed")
            yield sse_event("error", {"message": str(e)})

    return EventSourceResponse(event_gen())
