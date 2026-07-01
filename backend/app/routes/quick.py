"""POST /api/quick — single-agent streaming analysis."""
from __future__ import annotations

import asyncio
import logging
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.config import get_settings
from app.services import auth, budget, events, reports
from app.services.financials import get_financials
from app.services.market_data import get_snapshot
from app.services.rate_limit import enforce_scope
from app.services.skill_runner import sse_event, stream_quick

log = logging.getLogger(__name__)

router = APIRouter()


class QuickRequest(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=16)
    market: Literal["US", "CN", "HK"] = "US"
    skill: Literal["buffett", "serenity"] = "buffett"
    language: Literal["en", "zh"] = "en"
    question: str | None = Field(None, max_length=2000)
    # Position diagnosis (optional): when cost_basis is set, the agent gives a
    # hold/add/trim/sell recommendation framed against the user's entry.
    cost_basis: float | None = Field(None, gt=0)
    shares: float | None = Field(None, gt=0)
    buy_date: str | None = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")


@router.post("/quick")
async def quick(request: Request, req: QuickRequest) -> EventSourceResponse:
    settings = get_settings()

    # Pre-fetch market data — fail fast on bad ticker BEFORE charging the
    # rate-limit counter. This means typos don't burn quota.
    try:
        snapshot = get_snapshot(req.ticker, req.market)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        log.exception("snapshot pre-fetch failed for %s/%s", req.ticker, req.market)
        raise HTTPException(status_code=502, detail=f"upstream data error: {e}") from e

    # Signed-in users are unlimited on quick-scope; anonymous keep the anon cap.
    user = auth.user_from_request(request)
    enforce_scope(request, "quick", user)

    # Budget gate — cheaper than starting the SSE stream and aborting.
    budget.assert_within_budget()

    # Comprehensive multi-period financials for the agent (best-effort, cached
    # ~6h; run off-thread so the blocking upstream fetch doesn't stall the loop).
    financials = None
    try:
        financials = await asyncio.to_thread(get_financials, req.ticker, req.market)
    except Exception:
        log.warning("financials fetch failed for %s/%s", req.ticker, req.market)

    async def event_gen():
        # Send the snapshot up front so the frontend can render the chart
        # immediately, in parallel with the LLM streaming.
        yield sse_event("snapshot", snapshot.model_dump())
        chunks: list[str] = []
        try:
            # Quick is one LLM call against a 158k-char system prompt — Flash
            # is the right tier here, keeps cost ~3x lower than Pro while the
            # buffett framework is doing most of the heavy lifting.
            async for event_name, payload in stream_quick(
                skill_name=req.skill,
                snapshot=snapshot,
                financials=financials,
                user_question=req.question,
                cost_basis=req.cost_basis,
                shares=req.shares,
                buy_date=req.buy_date,
                language=req.language,
                model=settings.quick_think_llm,
            ):
                if event_name == "token":
                    chunks.append(payload.get("text", ""))
                # Charge the daily budget when the run finishes.
                if event_name == "done":
                    cost = float(payload.get("cost_usd", 0) or 0)
                    new_total = budget.add_cost(cost)
                    payload["budget_today_usd"] = round(new_total, 6)
                    run_mode = (
                        "diagnose" if req.cost_basis is not None
                        else "serenity" if req.skill == "serenity"
                        else "quick"
                    )
                    events.record_run(request, mode=run_mode, ticker=req.ticker,
                                      market=req.market, cost_usd=cost)
                    if user and chunks:
                        try:
                            meta = reports.save_report(
                                user.id,
                                ticker=req.ticker,
                                market=req.market,
                                mode=run_mode,
                                language=req.language,
                                content="".join(chunks),
                                cost_usd=cost,
                            )
                            payload["saved_report_id"] = meta.id
                        except Exception:
                            log.exception("save quick report failed")
                yield sse_event(event_name, payload)
        except Exception as e:
            log.exception("quick stream failed")
            yield sse_event("error", {"message": str(e)})

    return EventSourceResponse(event_gen())
