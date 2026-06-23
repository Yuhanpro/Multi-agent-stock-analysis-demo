"""POST /api/quick — single-agent streaming analysis."""
from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.config import get_settings
from app.services import budget
from app.services.market_data import get_snapshot
from app.services.rate_limit import check_and_count
from app.services.skill_runner import sse_event, stream_quick

log = logging.getLogger(__name__)

router = APIRouter()


class QuickRequest(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=16)
    market: Literal["US", "CN", "HK"] = "US"
    skill: Literal["buffett", "serenity"] = "buffett"
    language: Literal["en", "zh"] = "en"
    question: str | None = Field(None, max_length=2000)


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

    # Real request — count it against the per-IP quota.
    check_and_count(request, scope="quick", limit=settings.rate_limit_quick)

    # Budget gate — cheaper than starting the SSE stream and aborting.
    budget.assert_within_budget()

    async def event_gen():
        # Send the snapshot up front so the frontend can render the chart
        # immediately, in parallel with the LLM streaming.
        yield sse_event("snapshot", snapshot.model_dump())
        try:
            # Quick is one LLM call against a 158k-char system prompt — Flash
            # is the right tier here, keeps cost ~3x lower than Pro while the
            # buffett framework is doing most of the heavy lifting.
            async for event_name, payload in stream_quick(
                skill_name=req.skill,
                snapshot=snapshot,
                user_question=req.question,
                language=req.language,
                model=settings.quick_think_llm,
            ):
                # Charge the daily budget when the run finishes.
                if event_name == "done":
                    cost = float(payload.get("cost_usd", 0) or 0)
                    new_total = budget.add_cost(cost)
                    payload["budget_today_usd"] = round(new_total, 6)
                yield sse_event(event_name, payload)
        except Exception as e:
            log.exception("quick stream failed")
            yield sse_event("error", {"message": str(e)})

    return EventSourceResponse(event_gen())
