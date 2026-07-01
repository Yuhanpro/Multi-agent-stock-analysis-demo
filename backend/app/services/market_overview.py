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
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from pydantic import BaseModel

from app.services import db
from app.services.market_data import _pct, _safe_float, get_cn_spot

log = logging.getLogger(__name__)

_CACHE: dict[str, tuple[float, "MarketOverview"]] = {}
_TTL = 300
_REFRESHING: set[str] = set()          # markets currently refreshing in background
_REFRESH_LOCK = threading.Lock()

# US/HK have no reliable market-wide turnover feed from the mainland VPS
# (the EM spot/famous endpoints route through push2.eastmoney → blocked, and the
# Sina full spot tables time out). So we show "today's move" for a curated set of
# major names via Sina daily (stock_us_daily / stock_hk_daily), which IS reliable.
_CURATED: dict[str, list[tuple[str, str]]] = {
    "US": [
        ("AAPL", "Apple"), ("NVDA", "NVIDIA"), ("MSFT", "Microsoft"), ("GOOGL", "Alphabet"),
        ("AMZN", "Amazon"), ("META", "Meta"), ("TSLA", "Tesla"), ("AVGO", "Broadcom"),
        ("AMD", "AMD"), ("TSM", "TSMC"), ("NFLX", "Netflix"), ("CRM", "Salesforce"),
    ],
    "HK": [
        ("00700", "腾讯控股"), ("09988", "阿里巴巴"), ("03690", "美团"), ("01810", "小米集团"),
        ("09618", "京东集团"), ("00939", "建设银行"), ("02318", "中国平安"), ("00388", "香港交易所"),
        ("01299", "友邦保险"), ("09999", "网易"), ("02020", "安踏体育"), ("00005", "汇丰控股"),
    ],
}


class IndexQuote(BaseModel):
    code: str
    name: str
    price: float | None = None
    change_pct: float | None = None


class NewsItem(BaseModel):
    title: str
    summary: str | None = None
    time: str | None = None
    url: str | None = None


class Breadth(BaseModel):
    advancers: int | None = None   # 上涨家数
    decliners: int | None = None   # 下跌家数
    flat: int | None = None
    limit_up: int | None = None    # 涨停家数


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
    indices: list[IndexQuote] = []
    breadth: Breadth | None = None
    hot_industries: list[HotIndustry] = []
    hot_companies: list[HotCompany] = []
    news: list[NewsItem] = []
    site_top: list[SiteTop] = []
    source: str = ""


# Major A-share indices (Sina codes), in display order.
_INDEX_CODES: list[tuple[str, str]] = [
    ("sh000001", "上证指数"), ("sz399001", "深证成指"), ("sz399006", "创业板指"),
    ("sh000300", "沪深300"), ("sh000688", "科创50"),
]


def _indices() -> list[IndexQuote]:
    import akshare as ak

    df = ak.stock_zh_index_spot_sina()
    if df is None or df.empty:
        return []
    by_code = {str(r["代码"]): r for _, r in df.iterrows()}
    out: list[IndexQuote] = []
    for code, name in _INDEX_CODES:
        r = by_code.get(code)
        if r is not None:
            out.append(IndexQuote(
                code=code, name=name,
                price=_safe_float(r.get("最新价")), change_pct=_pct(r.get("涨跌幅")),
            ))
    return out


# Keyword buckets to tag the (China-centric) global feed by market. There is no
# per-market news API reachable from the VPS, so we classify each item: HK first,
# then US, else CN (the default bucket — A-share + global macro).
_US_KW = ("美股", "纳斯达克", "纳指", "道指", "道琼斯", "标普", "美联储", "鲍威尔", "华尔街",
          "苹果公司", "特斯拉", "英伟达", "美国经济", "美国股市", "非农", "美债", "美国市场")
_HK_KW = ("港股", "恒生", "恒指", "香港", "港交所", "南向", "H股", "港元")


def _classify_news(text: str) -> str:
    if any(k in text for k in _HK_KW):
        return "HK"
    if any(k in text for k in _US_KW):
        return "US"
    return "CN"


def _news(market: str = "CN", limit: int = 24) -> list[NewsItem]:
    """东财全球财经快讯,按市场关键词过滤。CN=默认桶(A股+宏观);US/HK=对应标签。"""
    import akshare as ak

    df = ak.stock_info_global_em()
    if df is None or df.empty:
        return []
    out: list[NewsItem] = []
    for _, r in df.iterrows():
        title = str(r.get("标题") or "").strip()
        if not title:
            continue
        summ = r.get("摘要")
        text = title + " " + (str(summ) if summ is not None else "")
        if _classify_news(text) != market:
            continue
        url = r.get("链接")
        out.append(NewsItem(
            title=title,
            summary=(str(summ).strip() or None) if summ is not None else None,
            time=str(r.get("发布时间")) if r.get("发布时间") is not None else None,
            url=str(url) if url is not None else None,
        ))
        if len(out) >= limit:
            break
    return out


def _breadth() -> Breadth | None:
    """Market breadth: advancers/decliners (whole-market spot) + limit-up count.
    北向资金实时净流入自 2024-08 起官方停止披露(接口恒为 0),故改用涨跌家数。"""
    import akshare as ak
    import pandas as pd

    b = Breadth()
    df = get_cn_spot()
    if df is not None and not getattr(df, "empty", True) and "涨跌幅" in df.columns:
        chg = pd.to_numeric(df["涨跌幅"], errors="coerce")
        b.advancers = int((chg > 0).sum())
        b.decliners = int((chg < 0).sum())
        b.flat = int((chg == 0).sum())

    from datetime import timedelta
    cn_now = datetime.now(timezone.utc) + timedelta(hours=8)
    for back in range(0, 4):  # walk back to the latest trading day with data
        d = (cn_now - timedelta(days=back)).strftime("%Y%m%d")
        try:
            zt = ak.stock_zt_pool_em(date=d)
            if zt is not None and len(zt) > 0:
                b.limit_up = int(len(zt))
                break
        except Exception:
            continue

    if b.advancers is None and b.limit_up is None:
        return None
    return b


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


def _daily_move(ticker: str, market: str):
    """(price, change_pct, approx_turnover) from Sina daily — reliable on the VPS."""
    import akshare as ak

    if market == "US":
        df = ak.stock_us_daily(symbol=ticker.upper(), adjust="")
    else:
        df = ak.stock_hk_daily(symbol=ticker.zfill(5), adjust="")
    if df is None or df.empty or len(df) < 2:
        return None
    last, prev = df.iloc[-1], df.iloc[-2]
    close = _safe_float(last.get("close"))
    pclose = _safe_float(prev.get("close"))
    vol = _safe_float(last.get("volume"))
    chg = ((close - pclose) / pclose) if (close and pclose) else None
    amt = (vol * close) if (vol and close) else None
    return close, chg, amt


def _curated_companies(market: str) -> list[HotCompany]:
    items = _CURATED.get(market, [])
    if not items:
        return []

    def fetch(pair: tuple[str, str]) -> "HotCompany | None":
        code, name = pair
        try:
            r = _daily_move(code, market)
            if r:
                price, chg, amt = r
                return HotCompany(code=code, name=name, market=market,
                                  price=price, change_pct=chg, amount=amt)
        except Exception as e:
            log.warning("daily move %s/%s failed: %s", code, market, e)
        return None

    # Each ticker is an independent Sina fetch — run them concurrently instead of
    # one-by-one (was the main US/HK slowdown: N sequential network round-trips).
    with ThreadPoolExecutor(max_workers=min(10, len(items))) as ex:
        out = [hc for hc in ex.map(fetch, items) if hc]
    out.sort(key=lambda x: (x.change_pct if x.change_pct is not None else -999), reverse=True)
    return out


def _site_top(market: str) -> list[SiteTop]:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    rows = db.query_all(
        "SELECT ticker, market, COUNT(*) AS c FROM reports "
        "WHERE substr(created_at, 1, 10) = ? AND market = ? "
        "GROUP BY ticker, market ORDER BY c DESC LIMIT 10",
        (today, market),
    )
    return [SiteTop(ticker=r["ticker"], market=r["market"], count=r["c"]) for r in rows]


def _parallel(tasks: dict[str, "callable"]) -> dict:
    """Run independent fetchers concurrently; a failing task yields None."""
    results: dict = {}
    with ThreadPoolExecutor(max_workers=min(8, len(tasks) or 1)) as ex:
        futs = {ex.submit(fn): key for key, fn in tasks.items()}
        for fut, key in futs.items():
            try:
                results[key] = fut.result()
            except Exception as e:
                log.warning("overview task %s failed: %s", key, e)
                results[key] = None
    return results


def _compute(market: str) -> MarketOverview:
    ov = MarketOverview(source="sina")
    if market == "CN":
        # All independent; get_cn_spot() is lock-guarded so companies + breadth
        # share one fetch, which overlaps the indices/news round-trips.
        r = _parallel({
            "spot": get_cn_spot,   # kick off the shared A-share fetch early
            "indices": _indices,
            "industries": _industries,
            "companies": _companies,
            "breadth": _breadth,
            "news": lambda: _news(market),
            "site_top": lambda: _site_top(market),
        })
        ov.indices = r.get("indices") or []
        ov.hot_industries = r.get("industries") or []
        ov.hot_companies = r.get("companies") or []
        ov.breadth = r.get("breadth")
    else:
        r = _parallel({
            "companies": lambda: _curated_companies(market),
            "news": lambda: _news(market),
            "site_top": lambda: _site_top(market),
        })
        ov.hot_companies = r.get("companies") or []
    ov.news = r.get("news") or []
    ov.site_top = r.get("site_top") or []
    return ov


def _refresh(market: str) -> None:
    try:
        _CACHE[market] = (time.time(), _compute(market))
    except Exception as e:
        log.warning("overview refresh %s failed: %s", market, e)
    finally:
        with _REFRESH_LOCK:
            _REFRESHING.discard(market)


def get_overview(market: str = "CN") -> MarketOverview:
    market = market if market in ("CN", "US", "HK") else "CN"
    hit = _CACHE.get(market)
    now = time.time()
    if hit and now - hit[0] < _TTL:
        return hit[1]
    if hit:
        # Stale-while-revalidate: serve the stale copy instantly, refresh in the
        # background so a user never waits on the upstream fetch after warm-up.
        with _REFRESH_LOCK:
            if market not in _REFRESHING:
                _REFRESHING.add(market)
                threading.Thread(target=_refresh, args=(market,), daemon=True).start()
        return hit[1]
    ov = _compute(market)  # cold cache — compute synchronously this once
    _CACHE[market] = (time.time(), ov)
    return ov


def warm() -> None:
    """Prime CN/US/HK caches at startup so first requests are instant."""
    for m in ("CN", "US", "HK"):
        try:
            _CACHE[m] = (time.time(), _compute(m))
            log.info("market-overview warmed: %s", m)
        except Exception as e:
            log.warning("market-overview warm %s failed: %s", m, e)
