"""Fund (开放式基金 / ETF) data: info, NAV history, holdings, performance.

All sources are reachable from the mainland VPS (verified): xueqiu basic info,
EastMoney fund-NAV host (works for open funds AND ETFs), and EastMoney portfolio
holdings. Cached a few hours since NAV/holdings change slowly.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone

from pydantic import BaseModel

from app.services.market_data import _safe_float

log = logging.getLogger(__name__)

_CACHE: dict[str, tuple[float, "Fund"]] = {}
_TTL = 6 * 3600
_NAMES_CACHE: tuple[float, dict[str, tuple[str, str]]] | None = None


def _names() -> dict[str, tuple[str, str]]:
    """code -> (简称, 类型) from the full fund list; used to backfill ETFs where
    the xueqiu basic-info endpoint returns nothing. Cached 24h."""
    global _NAMES_CACHE
    if _NAMES_CACHE and time.time() - _NAMES_CACHE[0] < 24 * 3600:
        return _NAMES_CACHE[1]
    import akshare as ak

    d: dict[str, tuple[str, str]] = {}
    try:
        df = ak.fund_name_em()
        cols = list(df.columns)
        for _, r in df.iterrows():
            d[str(r[cols[0]])] = (str(r[cols[2]]), str(r[cols[3]]))
    except Exception as e:
        log.warning("fund_name_em failed: %s", e)
    _NAMES_CACHE = (time.time(), d)
    return d


class NavPoint(BaseModel):
    date: str
    nav: float | None = None
    growth: float | None = None  # daily % (raw, e.g. 1.89)


class FundHolding(BaseModel):
    ticker: str
    name: str
    pct: float | None = None  # % of NAV


class Fund(BaseModel):
    code: str
    name: str = ""
    full_name: str | None = None
    type: str | None = None
    company: str | None = None
    manager: str | None = None
    scale: str | None = None
    inception: str | None = None
    benchmark: str | None = None
    strategy: str | None = None
    nav: list[NavPoint] = []
    holdings: list[FundHolding] = []
    holdings_quarter: str | None = None
    returns: dict[str, float | None] = {}  # decimals
    source: str = "akshare"


def _parse(d: str) -> datetime | None:
    try:
        return datetime.strptime(d[:10], "%Y-%m-%d")
    except Exception:
        return None


def _window_return(nav: list[NavPoint], days: int) -> float | None:
    if len(nav) < 2 or nav[-1].nav is None:
        return None
    last = nav[-1]
    last_d = _parse(last.date)
    if not last_d:
        return None
    target = last_d - timedelta(days=days)
    past = None
    for p in nav:
        pd = _parse(p.date)
        if pd and pd <= target:
            past = p
        elif pd and pd > target:
            break
    if past and past.nav:
        return last.nav / past.nav - 1
    return None


def _ytd_return(nav: list[NavPoint]) -> float | None:
    if not nav or nav[-1].nav is None:
        return None
    year = nav[-1].date[:4]
    base = next((p for p in nav if p.date[:4] == year and p.nav), None)
    if base and base.nav:
        return nav[-1].nav / base.nav - 1
    return None


def get_fund(code: str) -> Fund:
    code = code.strip()
    hit = _CACHE.get(code)
    if hit and time.time() - hit[0] < _TTL:
        return hit[1]
    import akshare as ak

    f = Fund(code=code)

    # ---- basic info (xueqiu) ----
    try:
        bi = ak.fund_individual_basic_info_xq(symbol=code)
        kv = dict(zip(bi["item"].astype(str), bi["value"]))
        f.name = str(kv.get("基金名称") or kv.get("基金简称") or code)
        f.full_name = _str(kv.get("基金全称"))
        f.type = _str(kv.get("基金类型"))
        f.company = _str(kv.get("基金公司"))
        f.manager = _str(kv.get("基金经理"))
        f.scale = _str(kv.get("最新规模"))
        f.inception = _str(kv.get("成立时间"))
        f.benchmark = _str(kv.get("业绩比较基准"))
        f.strategy = (_str(kv.get("投资策略")) or "")[:400] or None
    except Exception as e:
        log.warning("fund basic info failed for %s: %s", code, e)

    # Backfill name/type from the full fund list (ETFs lack xueqiu basic info).
    if not f.name or f.name == code:
        nm = _names().get(code)
        if nm:
            f.name = nm[0] or f.name or code
            f.type = f.type or nm[1]
    if not f.name:
        f.name = code

    # ---- NAV history (works for open funds and ETFs) ----
    try:
        df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
        if df is not None and not df.empty:
            cols = list(df.columns)
            for _, r in df.iterrows():
                f.nav.append(NavPoint(
                    date=str(r[cols[0]])[:10],
                    nav=_safe_float(r[cols[1]]),
                    growth=_safe_float(r[cols[2]]) if len(cols) > 2 else None,
                ))
    except Exception as e:
        log.warning("fund NAV failed for %s: %s", code, e)

    if f.nav:
        f.returns = {k: v for k, v in {
            "1m": _window_return(f.nav, 30),
            "3m": _window_return(f.nav, 91),
            "6m": _window_return(f.nav, 182),
            "1y": _window_return(f.nav, 365),
            "ytd": _ytd_return(f.nav),
            "since": (f.nav[-1].nav / f.nav[0].nav - 1) if (f.nav[-1].nav and f.nav[0].nav) else None,
        }.items() if v is not None}

    # ---- holdings (latest quarter, top 10) ----
    try:
        year = datetime.now(timezone.utc).strftime("%Y")
        hold = ak.fund_portfolio_hold_em(symbol=code, date=year)
        if hold is None or hold.empty:
            hold = ak.fund_portfolio_hold_em(symbol=code, date=str(int(year) - 1))
        if hold is not None and not hold.empty:
            qcol = "季度" if "季度" in hold.columns else hold.columns[-1]
            latest_q = max(hold[qcol].astype(str))
            sub = hold[hold[qcol].astype(str) == latest_q].head(10)
            f.holdings_quarter = latest_q
            for _, r in sub.iterrows():
                f.holdings.append(FundHolding(
                    ticker=str(r.get("股票代码") or ""),
                    name=str(r.get("股票名称") or ""),
                    pct=_safe_float(r.get("占净值比例")),
                ))
    except Exception as e:
        log.warning("fund holdings failed for %s: %s", code, e)

    _CACHE[code] = (time.time(), f)
    return f


def _str(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s if s and s.lower() != "nan" else None
