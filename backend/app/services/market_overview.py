"""Today's market heat: hot industries + most-active companies + on-site top.

The genuine 人气榜 / Baidu hot-search endpoints route through push2.eastmoney.com,
which is unreachable from the mainland VPS, so we use reliable Sina sources as an
attention proxy: industry-board performance + turnover-ranked companies — plus
the truly on-platform signal: which tickers our own users analyzed today.
Cached ~5 min.
"""
from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timezone

from pydantic import BaseModel

from app.services import db
from app.services.market_data import _pct, _safe_float, get_cn_spot

log = logging.getLogger(__name__)

_CACHE: tuple[float, "MarketOverview"] | None = None
_TTL = 300


class HotIndustry(BaseModel):
    name: str
    change_pct: float | None = None
    amount: float | None = None
    num_companies: int | None = None
    leader_name: str | None = None
    leader_change: float | None = None


class HotCompany(BaseModel):
    code: str
    name: str
    market: str = "CN"
    price: float | None = None
    change_pct: float | None = None
    amount: float | None = None


class SiteTop(BaseModel):
    ticker: str
    market: str
    count: int


class MarketOverview(BaseModel):
    hot_industries: list[HotIndustry] = []
    hot_companies: list[HotCompany] = []
    site_top: list[SiteTop] = []
    source: str = ""


def _industries() -> list[HotIndustry]:
    import akshare as ak

    df = ak.stock_sector_spot(indicator="新浪行业")
    if df is None or df.empty:
        return []
    cols = list(df.columns)
    # Positional access — Sina's headers are inconsistent/GBK-ish. Layout:
    # 0 id · 1 name · 2 num · 3 avg · 4 chg · 5 chg% · 6 vol · 7 amount ·
    # 8 leader_code · 9 leader_chg · 10 leader_price · 11 leader_chg% · 12 leader_name
    d = df.copy()
    d["_chg"] = d[cols[5]].map(_safe_float)
    d = d.sort_values("_chg", ascending=False).head(12)
    out: list[HotIndustry] = []
    for _, r in d.iterrows():
        out.append(HotIndustry(
            name=str(r[cols[1]]),
            change_pct=_pct(r[cols[5]]),
            amount=_safe_float(r[cols[7]]),
            num_companies=int(_safe_float(r[cols[2]]) or 0) or None,
            leader_name=str(r[cols[12]]) if len(cols) > 12 else None,
            leader_change=_pct(r[cols[11]]) if len(cols) > 11 else None,
        ))
    return out


def _companies() -> list[HotCompany]:
    df = get_cn_spot()
    if df is None or getattr(df, "empty", True):
        return []
    d = df.copy()
    d["_amt"] = d["成交额"].map(_safe_float)
    d = d.sort_values("_amt", ascending=False).head(20)
    out: list[HotCompany] = []
    for _, r in d.iterrows():
        code = re.sub(r"\D", "", str(r.get("代码"))) or str(r.get("代码"))
        out.append(HotCompany(
            code=code,
            name=str(r.get("名称")),
            price=_safe_float(r.get("最新价")),
            change_pct=_pct(r.get("涨跌幅")),
            amount=_safe_float(r.get("成交额")),
        ))
    return out


def _site_top() -> list[SiteTop]:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    rows = db.query_all(
        "SELECT ticker, market, COUNT(*) AS c FROM reports WHERE substr(created_at, 1, 10) = ? "
        "GROUP BY ticker, market ORDER BY c DESC LIMIT 10",
        (today,),
    )
    return [SiteTop(ticker=r["ticker"], market=r["market"], count=r["c"]) for r in rows]


def get_overview() -> MarketOverview:
    global _CACHE
    if _CACHE and time.time() - _CACHE[0] < _TTL:
        return _CACHE[1]
    ov = MarketOverview(source="sina 行业板块 + 成交活跃 + 本站统计")
    try:
        ov.hot_industries = _industries()
    except Exception as e:
        log.warning("hot industries failed: %s", e)
    try:
        ov.hot_companies = _companies()
    except Exception as e:
        log.warning("hot companies failed: %s", e)
    try:
        ov.site_top = _site_top()
    except Exception as e:
        log.warning("site top failed: %s", e)
    _CACHE = (time.time(), ov)
    return ov
