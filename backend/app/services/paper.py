"""Paper trading (模拟盘): virtual cash, market orders, derived positions + P&L.

No fees / no T+1 in the MVP — instant fill at the latest price. Positions are
derived from the trade ledger (average-cost basis); cash is the source of truth
on the account row. A-shares price in real time (Sina spot); US/HK at last close.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from pydantic import BaseModel

from app.services import db

START_CASH = 1_000_000.0


class Position(BaseModel):
    ticker: str
    market: str
    shares: float
    avg_cost: float
    price: float | None = None
    market_value: float | None = None
    pnl: float | None = None
    pnl_pct: float | None = None


class Portfolio(BaseModel):
    cash: float
    start_cash: float
    positions: list[Position] = []
    market_value: float = 0.0     # sum of position values
    total: float = 0.0            # cash + market_value
    total_pnl: float = 0.0        # total - start_cash
    total_pnl_pct: float = 0.0


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_account(user_id: int) -> dict:
    r = db.query_one("SELECT cash, start_cash FROM paper_account WHERE user_id = ?", (user_id,))
    if r is None:
        db.execute(
            "INSERT INTO paper_account (user_id, cash, start_cash, created_at) VALUES (?, ?, ?, ?)",
            (user_id, START_CASH, START_CASH, _now()),
        )
        return {"cash": START_CASH, "start_cash": START_CASH}
    return {"cash": r["cash"], "start_cash": r["start_cash"]}


def _price(ticker: str, market: str) -> float | None:
    from app.services.market_data import _safe_float, get_cn_spot, get_snapshot

    market = (market or "CN").upper()
    if market == "CN":
        try:
            df = get_cn_spot()
            if df is not None and not getattr(df, "empty", True):
                code = re.sub(r"\D", "", ticker)
                sub = df[df["代码"].astype(str).str.contains(code, na=False)]
                if not sub.empty:
                    p = _safe_float(sub.iloc[0].get("最新价"))
                    if p:
                        return p
        except Exception:
            pass
    try:
        return get_snapshot(ticker, market).price
    except Exception:
        return None


def _raw_positions(user_id: int) -> list[dict]:
    """Net holdings + average buy cost, derived from the trade ledger."""
    rows = db.query_all(
        "SELECT ticker, market, side, shares, price FROM paper_trades WHERE user_id = ?",
        (user_id,),
    )
    agg: dict[tuple[str, str], dict] = {}
    for r in rows:
        key = (r["ticker"], r["market"])
        a = agg.setdefault(key, {"net": 0.0, "buy_sh": 0.0, "buy_cost": 0.0})
        if r["side"] == "buy":
            a["net"] += r["shares"]
            a["buy_sh"] += r["shares"]
            a["buy_cost"] += r["shares"] * r["price"]
        else:
            a["net"] -= r["shares"]
    out = []
    for (ticker, market), a in agg.items():
        if a["net"] <= 1e-9:
            continue
        avg = a["buy_cost"] / a["buy_sh"] if a["buy_sh"] else 0.0
        out.append({"ticker": ticker, "market": market, "shares": a["net"], "avg_cost": avg})
    return out


def portfolio(user_id: int) -> Portfolio:
    acc = get_account(user_id)
    raw = _raw_positions(user_id)
    positions: list[Position] = []
    mv = 0.0
    for p in raw:
        price = _price(p["ticker"], p["market"])
        pos = Position(ticker=p["ticker"], market=p["market"], shares=p["shares"], avg_cost=round(p["avg_cost"], 4))
        if price is not None:
            pos.price = price
            pos.market_value = round(price * p["shares"], 2)
            pos.pnl = round((price - p["avg_cost"]) * p["shares"], 2)
            pos.pnl_pct = round((price / p["avg_cost"] - 1), 4) if p["avg_cost"] else None
            mv += pos.market_value
        positions.append(pos)
    positions.sort(key=lambda x: (x.market_value or 0), reverse=True)
    total = acc["cash"] + mv
    pnl = total - acc["start_cash"]
    return Portfolio(
        cash=round(acc["cash"], 2), start_cash=acc["start_cash"], positions=positions,
        market_value=round(mv, 2), total=round(total, 2),
        total_pnl=round(pnl, 2), total_pnl_pct=round(pnl / acc["start_cash"], 4) if acc["start_cash"] else 0.0,
    )


def place_order(user_id: int, ticker: str, market: str, side: str, shares: float) -> Portfolio:
    ticker = ticker.strip().upper()
    market = (market or "CN").upper()
    if side not in ("buy", "sell"):
        raise ValueError("方向必须是 buy / sell")
    if shares <= 0:
        raise ValueError("股数必须大于 0")
    price = _price(ticker, market)
    if price is None or price <= 0:
        raise ValueError("取不到该标的的当前价格,无法下单")

    acc = get_account(user_id)
    cost = shares * price
    if side == "buy":
        if cost > acc["cash"] + 1e-6:
            raise ValueError(f"现金不足:需要 {cost:,.2f},可用 {acc['cash']:,.2f}")
        new_cash = acc["cash"] - cost
    else:
        held = next((p["shares"] for p in _raw_positions(user_id)
                     if p["ticker"] == ticker and p["market"] == market), 0.0)
        if shares > held + 1e-6:
            raise ValueError(f"持仓不足:持有 {held:g} 股")
        new_cash = acc["cash"] + cost

    db.execute(
        "INSERT INTO paper_trades (user_id, ticker, market, side, shares, price, ts) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (user_id, ticker, market, side, shares, price, _now()),
    )
    db.execute("UPDATE paper_account SET cash = ? WHERE user_id = ?", (new_cash, user_id))
    return portfolio(user_id)


def reset(user_id: int) -> Portfolio:
    db.execute("DELETE FROM paper_trades WHERE user_id = ?", (user_id,))
    db.execute("UPDATE paper_account SET cash = start_cash WHERE user_id = ?", (user_id,))
    get_account(user_id)
    return portfolio(user_id)
