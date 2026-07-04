"""美股板块资金方向(近似) + 港股南向资金(真实)。

美股没有 A 股那种逐单拆分的免费主力资金流数据(真实订单流在 Bloomberg 等付费
终端里),这里用 SPDR 行业 ETF 的「涨跌幅 + 美元成交额 + 量比」做板块资金方向
近似:涨且放量 ≈ 资金流入,跌且放量 ≈ 流出。数据走 stock_us_daily(新浪,
VPS 可达、EOD 日线),页面明确标注"方向近似,非真实订单流"。

港股通南向资金为交易所公布的真实成交净买额(stock_hsgt_fund_flow_summary_em)。

构建需要 13 次 ETF 日线请求(~30s),故启动预热 + 长缓存(EOD 数据,30 分钟
TTL 足够),stale-while-revalidate 与 hotspot 的桑基图同一模式。
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta, timezone

from pydantic import BaseModel

from app.services.market_data import _safe_float

log = logging.getLogger(__name__)

# SPDR sector ETFs — the standard 11-sector split of the S&P 500.
US_SECTORS: list[tuple[str, str]] = [
    ("XLK", "科技"), ("XLC", "通信"), ("XLY", "可选消费"), ("XLP", "必选消费"),
    ("XLV", "医疗"), ("XLF", "金融"), ("XLI", "工业"), ("XLB", "材料"),
    ("XLE", "能源"), ("XLU", "公用事业"), ("XLRE", "地产"),
]
US_BENCH: list[tuple[str, str]] = [("SPY", "标普500"), ("QQQ", "纳指100")]

_CACHE: tuple[float, "GlobalFlow"] | None = None
_TTL = 1800  # EOD data; a 30-min TTL only bounds staleness after US close
_lock = threading.Lock()
_refreshing = False


class UsSector(BaseModel):
    symbol: str
    name: str
    change_pct: float | None = None   # decimal, last close vs prev close
    amount: float | None = None       # USD dollar volume (close × volume)
    vol_ratio: float | None = None    # amount / prior-5-day average amount
    date: str | None = None


class HkSouthbound(BaseModel):
    board: str                        # 港股通(沪) / 港股通(深)
    net_buy: float | None = None      # 成交净买额, 亿元人民币
    date: str | None = None


class GlobalFlow(BaseModel):
    us: list[UsSector] = []
    us_bench: list[UsSector] = []
    us_date: str | None = None
    hk: list[HkSouthbound] = []
    hk_date: str | None = None
    updated: str = ""
    note: str = "美股为基于价格×成交额的方向近似,非真实订单流;港股通为交易所真实净买额"


def _us_sector(symbol: str, name: str) -> UsSector | None:
    import akshare as ak

    hist = ak.stock_us_daily(symbol=symbol, adjust="")
    if hist is None or hist.empty:
        return None
    tail = hist.tail(7)
    closes = [(_safe_float(r["close"]), _safe_float(r["volume"]), str(r["date"])[:10])
              for _, r in tail.iterrows()]
    closes = [(c, v, d) for c, v, d in closes if c and v]
    if len(closes) < 2:
        return None
    last_c, last_v, last_d = closes[-1]
    prev_c = closes[-2][0]
    amount = last_c * last_v
    prior = [c * v for c, v, _ in closes[:-1]][-5:]
    avg = sum(prior) / len(prior) if prior else None
    return UsSector(
        symbol=symbol, name=name,
        change_pct=(last_c - prev_c) / prev_c if prev_c else None,
        amount=amount,
        vol_ratio=round(amount / avg, 2) if avg else None,
        date=last_d,
    )


def _build_us() -> tuple[list[UsSector], list[UsSector], str | None]:
    sectors: list[UsSector] = []
    bench: list[UsSector] = []
    for sym, name in US_SECTORS:
        try:
            s = _us_sector(sym, name)
            if s:
                sectors.append(s)
        except Exception as e:
            log.warning("us sector %s failed: %s", sym, e)
    for sym, name in US_BENCH:
        try:
            s = _us_sector(sym, name)
            if s:
                bench.append(s)
        except Exception as e:
            log.warning("us bench %s failed: %s", sym, e)
    # 强流入(涨且额大)在前,强流出在后 — signed dollar volume.
    sectors.sort(key=lambda x: (x.amount or 0) * (1 if (x.change_pct or 0) >= 0 else -1), reverse=True)
    date = sectors[0].date if sectors else None
    return sectors, bench, date


def _build_hk() -> tuple[list[HkSouthbound], str | None]:
    import akshare as ak

    try:
        df = ak.stock_hsgt_fund_flow_summary_em()
    except Exception as e:
        log.warning("hsgt summary failed: %s", e)
        return [], None
    if df is None or df.empty:
        return [], None
    out: list[HkSouthbound] = []
    date = None
    for _, r in df.iterrows():
        if str(r.get("资金方向")) != "南向":
            continue
        date = str(r.get("交易日")) or date
        out.append(HkSouthbound(
            board=str(r.get("板块")),
            net_buy=_safe_float(r.get("成交净买额")),
            date=str(r.get("交易日")) or None,
        ))
    return out, date


def _build() -> GlobalFlow:
    cn_now = datetime.now(timezone.utc) + timedelta(hours=8)
    gf = GlobalFlow(updated=cn_now.strftime("%H:%M"))
    try:
        gf.us, gf.us_bench, gf.us_date = _build_us()
    except Exception as e:
        log.warning("global flow US failed: %s", e)
    try:
        gf.hk, gf.hk_date = _build_hk()
    except Exception as e:
        log.warning("global flow HK failed: %s", e)
    return gf


def _refresh() -> None:
    global _CACHE, _refreshing
    try:
        _CACHE = (time.time(), _build())
    except Exception as e:
        log.warning("global flow refresh failed: %s", e)
    finally:
        _refreshing = False


def get_global_flow() -> GlobalFlow:
    global _refreshing
    now = time.time()
    if _CACHE and now - _CACHE[0] < _TTL:
        return _CACHE[1]
    if _CACHE:  # stale → serve stale, refresh in background
        with _lock:
            if not _refreshing:
                _refreshing = True
                threading.Thread(target=_refresh, daemon=True).start()
        return _CACHE[1]
    with _lock:
        if _CACHE:
            return _CACHE[1]
        _refreshing = True
    _refresh()
    return _CACHE[1] if _CACHE else GlobalFlow()


def warm() -> None:
    """Prime US-sector + HK-southbound flow at startup (~30s of ETF fetches)."""
    global _refreshing
    _refreshing = True
    _refresh()
