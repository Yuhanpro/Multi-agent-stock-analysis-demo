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
# Full fund list (code/name/type/pinyin), loaded once. Powers both the ETF
# name backfill and fund search. Cached 24h.
_TABLE_CACHE: tuple[float, list[dict], dict[str, tuple[str, str]]] | None = None


def _fund_table() -> tuple[list[dict], dict[str, tuple[str, str]]]:
    global _TABLE_CACHE
    if _TABLE_CACHE and time.time() - _TABLE_CACHE[0] < 24 * 3600:
        return _TABLE_CACHE[1], _TABLE_CACHE[2]
    import akshare as ak

    rows: list[dict] = []
    cmap: dict[str, tuple[str, str]] = {}
    try:
        df = ak.fund_name_em()
        cols = list(df.columns)  # 基金代码 / 拼音缩写 / 基金简称 / 基金类型 / 拼音全称
        for _, r in df.iterrows():
            code, py, name, typ = str(r[cols[0]]), str(r[cols[1]]), str(r[cols[2]]), str(r[cols[3]])
            rows.append({"code": code, "name": name, "type": typ, "py": py.upper()})
            cmap[code] = (name, typ)
    except Exception as e:
        log.warning("fund_name_em failed: %s", e)
    _TABLE_CACHE = (time.time(), rows, cmap)
    return rows, cmap


def search_funds(q: str, limit: int = 15) -> list[dict]:
    q = (q or "").strip()
    if not q:
        return []
    qu = q.upper()
    tokens = [tk for tk in q.split() if tk]
    rows, _ = _fund_table()
    scored: list[tuple[int, int, dict]] = []
    for r in rows:
        code, name, py = r["code"], r["name"], r["py"]
        score = 0
        if code == q:
            score = 100
        elif q.isdigit() and code.startswith(q):
            score = 92
        elif name == q:
            score = 90
        elif name.startswith(q):
            score = 80
        elif q in name:
            score = 65
        elif len(tokens) > 1 and all(tk in name for tk in tokens):
            score = 60  # space-separated multi-keyword AND
        elif qu and qu in py:
            score = 45
        elif qu in code:
            score = 25
        if score:
            # tie-break: shorter (more specific) name first.
            scored.append((score, -len(name), {"code": code, "name": name, "type": r["type"]}))
    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return [d for _, _, d in scored[: max(1, min(limit, 30))]]


_ETF_CACHE: tuple[float, dict[str, dict]] | None = None


def _etf_spot() -> dict[str, dict]:
    """code -> realtime fields for ETFs (fund_etf_spot_em). Cached 60s."""
    global _ETF_CACHE
    if _ETF_CACHE and time.time() - _ETF_CACHE[0] < 60:
        return _ETF_CACHE[1]
    import akshare as ak

    d: dict[str, dict] = {}
    try:
        df = ak.fund_etf_spot_em()
        for _, r in df.iterrows():
            d[str(r.get("代码"))] = {
                "price": _safe_float(r.get("最新价")),
                "iopv": _safe_float(r.get("IOPV实时估值")),
                "premium": _safe_float(r.get("基金折价率")),
                "change_pct": _safe_float(r.get("涨跌幅")),
                "amount": _safe_float(r.get("成交额")),
                "updated": str(r.get("更新时间")) if r.get("更新时间") is not None else None,
            }
    except Exception as e:
        log.warning("etf spot failed: %s", e)
    _ETF_CACHE = (time.time(), d)
    return d


class NavPoint(BaseModel):
    date: str
    nav: float | None = None
    growth: float | None = None  # daily % (raw, e.g. 1.89)


class FundHolding(BaseModel):
    ticker: str
    name: str
    pct: float | None = None  # % of NAV


class FundRealtime(BaseModel):
    price: float | None = None
    iopv: float | None = None
    premium: float | None = None      # 折价率 %(正=折价,在 IOPV 下方)
    change_pct: float | None = None   # %
    amount: float | None = None
    updated: str | None = None


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
    max_drawdown: float | None = None  # decimal, negative (since inception)
    is_etf: bool = False
    realtime: FundRealtime | None = None
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
        f = hit[1]
    else:
        f = _build_fund(code)
        _CACHE[code] = (time.time(), f)
    # ETF realtime overlay — etf_spot is 60s-cached, fresher than the 6h fund cache.
    et = _etf_spot().get(code)
    if et and et.get("price") is not None:
        f.is_etf = True
        f.realtime = FundRealtime(**et)
    return f


def _build_fund(code: str) -> Fund:
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
        nm = _fund_table()[1].get(code)
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
        # max drawdown since inception (peak-to-trough on unit NAV).
        peak = 0.0
        mdd = 0.0
        for p in f.nav:
            if p.nav is None:
                continue
            peak = max(peak, p.nav)
            if peak > 0:
                mdd = min(mdd, p.nav / peak - 1)
        f.max_drawdown = round(mdd, 4) if mdd < 0 else None

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

    return f


def _str(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s if s and s.lower() != "nan" else None
