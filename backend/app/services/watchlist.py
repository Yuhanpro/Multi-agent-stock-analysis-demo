"""Per-user watchlist persistence (SQLite).

Previously a single global JSON file; now keyed by user_id in the shared SQLite
DB so each account has its own list. The legacy backend/data/watchlist.json is
no longer read.
"""
from __future__ import annotations

import json
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.services import db

Market = Literal["US", "CN", "HK"]
Mode = Literal["snapshot", "quick", "serenity", "debate"]


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


def _row_to_item(row) -> WatchlistItem:
    return WatchlistItem(
        ticker=row["ticker"],
        market=row["market"],
        enabled=bool(row["enabled"]),
        modes=json.loads(row["modes"] or '["snapshot"]'),
        note=row["note"] or "",
    )


def list_items(user_id: int) -> list[WatchlistItem]:
    rows = db.query_all(
        "SELECT * FROM watchlist WHERE user_id = ? ORDER BY enabled DESC, market, ticker",
        (user_id,),
    )
    return [_row_to_item(r) for r in rows]


def upsert_item(user_id: int, item: WatchlistItem) -> list[WatchlistItem]:
    db.execute(
        """INSERT INTO watchlist (user_id, ticker, market, enabled, modes, note)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, ticker, market) DO UPDATE SET
               enabled = excluded.enabled,
               modes   = excluded.modes,
               note    = excluded.note""",
        (user_id, item.ticker, item.market, int(item.enabled),
         json.dumps(item.modes, ensure_ascii=False), item.note),
    )
    return list_items(user_id)


def patch_item(user_id: int, ticker: str, market: Market, patch: dict) -> list[WatchlistItem]:
    ticker = ticker.strip().upper()
    row = db.query_one(
        "SELECT * FROM watchlist WHERE user_id = ? AND ticker = ? AND market = ?",
        (user_id, ticker, market),
    )
    if row is None:
        raise KeyError(f"watchlist item not found: {ticker}/{market}")
    current = _row_to_item(row)
    data = current.model_dump()
    data.update({k: v for k, v in patch.items() if v is not None})
    item = WatchlistItem.model_validate(data)
    return upsert_item(user_id, item)


def delete_item(user_id: int, ticker: str, market: Market) -> list[WatchlistItem]:
    ticker = ticker.strip().upper()
    cur = db.execute(
        "DELETE FROM watchlist WHERE user_id = ? AND ticker = ? AND market = ?",
        (user_id, ticker, market),
    )
    if cur.rowcount == 0:
        raise KeyError(f"watchlist item not found: {ticker}/{market}")
    return list_items(user_id)
