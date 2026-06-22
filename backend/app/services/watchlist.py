"""Watchlist persistence.

Small JSON-file store for the Stage-1 watchlist MVP. This deliberately avoids a
DB until we have history/report storage. The file lives under backend/data/ and
is safe for one uvicorn worker (our deployment uses workers=1).
"""
from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, field_validator

Market = Literal["US", "CN"]
Mode = Literal["snapshot", "quick", "serenity", "debate"]

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
WATCHLIST_PATH = DATA_DIR / "watchlist.json"
_lock = threading.Lock()


class WatchlistItem(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=16)
    market: Market = "US"
    enabled: bool = True
    modes: list[Mode] = Field(default_factory=lambda: ["snapshot", "quick"])
    note: str = Field("", max_length=200)

    @field_validator("ticker")
    @classmethod
    def normalize_ticker(cls, v: str) -> str:
        return v.strip().upper()

    @field_validator("modes")
    @classmethod
    def non_empty_unique_modes(cls, v: list[Mode]) -> list[Mode]:
        seen: list[Mode] = []
        for m in v:
            if m not in seen:
                seen.append(m)
        return seen or ["snapshot"]


def _ensure_file() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not WATCHLIST_PATH.exists():
        WATCHLIST_PATH.write_text("[]\n", encoding="utf-8")


def list_items() -> list[WatchlistItem]:
    with _lock:
        _ensure_file()
        raw = json.loads(WATCHLIST_PATH.read_text(encoding="utf-8") or "[]")
        return [WatchlistItem.model_validate(x) for x in raw]


def save_items(items: list[WatchlistItem]) -> list[WatchlistItem]:
    with _lock:
        _ensure_file()
        # stable order: enabled first, then market, then ticker
        items = sorted(items, key=lambda x: (not x.enabled, x.market, x.ticker))
        WATCHLIST_PATH.write_text(
            json.dumps([x.model_dump() for x in items], ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return items


def upsert_item(item: WatchlistItem) -> list[WatchlistItem]:
    items = list_items()
    replaced = False
    next_items: list[WatchlistItem] = []
    for existing in items:
        if existing.ticker == item.ticker and existing.market == item.market:
            next_items.append(item)
            replaced = True
        else:
            next_items.append(existing)
    if not replaced:
        next_items.append(item)
    return save_items(next_items)


def patch_item(ticker: str, market: Market, patch: dict) -> list[WatchlistItem]:
    ticker = ticker.strip().upper()
    items = list_items()
    next_items: list[WatchlistItem] = []
    found = False
    for existing in items:
        if existing.ticker == ticker and existing.market == market:
            found = True
            data = existing.model_dump()
            data.update({k: v for k, v in patch.items() if v is not None})
            next_items.append(WatchlistItem.model_validate(data))
        else:
            next_items.append(existing)
    if not found:
        raise KeyError(f"watchlist item not found: {ticker}/{market}")
    return save_items(next_items)


def delete_item(ticker: str, market: Market) -> list[WatchlistItem]:
    ticker = ticker.strip().upper()
    items = list_items()
    next_items = [x for x in items if not (x.ticker == ticker and x.market == market)]
    if len(next_items) == len(items):
        raise KeyError(f"watchlist item not found: {ticker}/{market}")
    return save_items(next_items)
