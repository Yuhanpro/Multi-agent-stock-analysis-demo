"""Watchlist CRUD routes (per authenticated user)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.services.auth import User, get_owner_user as get_current_user
from app.services.watchlist import (
    Market,
    Mode,
    WatchlistItem,
    delete_item,
    list_items,
    patch_item,
    upsert_item,
)

router = APIRouter()


class WatchlistUpsert(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=16)
    market: Market = "US"
    enabled: bool = True
    modes: list[Mode] = Field(default_factory=lambda: ["snapshot", "quick"])
    note: str = Field("", max_length=200)


class WatchlistPatch(BaseModel):
    enabled: bool | None = None
    modes: list[Mode] | None = None
    note: str | None = Field(None, max_length=200)


@router.get("/watchlist", response_model=list[WatchlistItem])
def get_watchlist(user: User = Depends(get_current_user)) -> list[WatchlistItem]:
    return list_items(user.id)


@router.post("/watchlist", response_model=list[WatchlistItem])
def post_watchlist(item: WatchlistUpsert, user: User = Depends(get_current_user)) -> list[WatchlistItem]:
    return upsert_item(user.id, WatchlistItem.model_validate(item.model_dump()))


@router.patch("/watchlist/{ticker}", response_model=list[WatchlistItem])
def patch_watchlist(
    ticker: str,
    patch: WatchlistPatch,
    market: Market = Query("US"),
    user: User = Depends(get_current_user),
) -> list[WatchlistItem]:
    try:
        return patch_item(user.id, ticker, market, patch.model_dump(exclude_unset=True))
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.delete("/watchlist/{ticker}", response_model=list[WatchlistItem])
def delete_watchlist(
    ticker: str,
    market: Market = Query("US"),
    user: User = Depends(get_current_user),
) -> list[WatchlistItem]:
    try:
        return delete_item(user.id, ticker, market)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
