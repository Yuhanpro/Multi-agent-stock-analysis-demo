"""POST /api/chat — multi-turn follow-up Q&A about a stock.

Grounded in the live snapshot and the prior analysis report; streams the
assistant reply as SSE (same wire format as /api/quick). One cheap LLM call
per turn (Flash tier).
"""
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
from app.services.skill_runner import sse_event, stream_followup

log = logging.getLogger(__name__)

router = APIRouter()


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=8000)


class ChatRequest(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=16)
    market: Literal["US", "CN", "HK"] = "US"
    language: Literal["en", "zh"] = "en"
    # The prior analysis report, sent as grounding context (optional).
    report: str | None = Field(None, max_length=40000)
    # Prior follow-up turns (excludes the new question). Capped server-side.
    history: list[ChatTurn] = Field(default_factory=list)
    question: str = Field(..., min_length=1, max_length=2000)


@router.post("/chat")
async def chat(request: Request, req: ChatRequest) -> EventSourceResponse:
    settings = get_settings()

    # Pre-fetch snapshot (cached ~60s) for live grounding — fail fast on a bad
    # ticker before charging quota.
    try:
        snapshot = get_snapshot(req.ticker, req.market)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        log.exception("snapshot pre-fetch failed for %s/%s", req.ticker, req.market)
        raise HTTPException(status_code=502, detail=f"upstream data error: {e}") from e

    # Each follow-up is a real LLM call — count it against the per-IP quota.
    check_and_count(request, scope="quick", limit=settings.rate_limit_quick)
    budget.assert_within_budget()

    async def event_gen():
        try:
            async for event_name, payload in stream_followup(
                snapshot=snapshot,
                report=req.report,
                history=[t.model_dump() for t in req.history],
                question=req.question,
                language=req.language,
                model=settings.quick_think_llm,
            ):
                if event_name == "done":
                    cost = float(payload.get("cost_usd", 0) or 0)
                    new_total = budget.add_cost(cost)
                    payload["budget_today_usd"] = round(new_total, 6)
                yield sse_event(event_name, payload)
        except Exception as e:
            log.exception("chat stream failed")
            yield sse_event("error", {"message": str(e)})

    return EventSourceResponse(event_gen())
