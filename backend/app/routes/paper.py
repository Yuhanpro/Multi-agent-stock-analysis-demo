"""Paper trading (模拟盘) — virtual portfolio + market orders. Auth required."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException

from pydantic import BaseModel, Field

from app.services import paper
from app.services.auth import User, get_owner_user as get_current_user

router = APIRouter()


class OrderBody(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=16)
    market: Literal["US", "CN", "HK"] = "CN"
    side: Literal["buy", "sell"]
    shares: float = Field(..., gt=0, le=1e9)


@router.get("/paper", response_model=paper.Portfolio)
def get_portfolio(user: User = Depends(get_current_user)) -> paper.Portfolio:
    return paper.portfolio(user.id)


@router.post("/paper/order", response_model=paper.Portfolio)
def order(body: OrderBody, user: User = Depends(get_current_user)) -> paper.Portfolio:
    try:
        return paper.place_order(user.id, body.ticker, body.market, body.side, body.shares)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/paper/reset", response_model=paper.Portfolio)
def reset(user: User = Depends(get_current_user)) -> paper.Portfolio:
    return paper.reset(user.id)
