"""A股「热点雷达」— 用可达数据(涨停池 + 全A快照 + 新浪行业)近似"资金在抢什么"。

真·主力资金净流入接口(eastmoney push2)在大陆 VPS 被墙,故改用**客观代理**:
  · 封板资金 = 把涨停封住所用的钱,直接反映抢筹力度
  · 连板梯队 = 强度结构(几连板各多少家、最高几连板)
  · 涨停按行业聚合 = 资金在抢哪个方向(主线雏形)
  · 放量涨幅榜 = 今天在放量拉升、还没走完的票
全部为客观行情统计,非荐股。缓存 ~90s。
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone

from pydantic import BaseModel

from app.services.market_data import _safe_float, get_cn_spot

log = logging.getLogger(__name__)

_CACHE: tuple[float, "Hotspot"] | None = None
_TTL = 90


class HotStock(BaseModel):
    code: str
    name: str
    change_pct: float | None = None   # decimal
    price: float | None = None
    amount: float | None = None       # 元
    turnover: float | None = None     # 换手率 %
    seal_fund: float | None = None    # 封板资金 元
    boards: int | None = None         # 连板数
    industry: str | None = None


class Ladder(BaseModel):
    boards: int   # 连板数(1=首板)
    count: int    # 家数


class HotSector(BaseModel):
    name: str
    change_pct: float | None = None
    amount: float | None = None
    limit_ups: int = 0              # 涨停家数(方向聚合用)
    seal_fund: float | None = None  # 该方向封板资金合计
    leaders: list[str] = []


class Mover(BaseModel):
    code: str
    name: str
    change_pct: float | None = None
    amount: float | None = None


class Hotspot(BaseModel):
    date: str | None = None
    zt_count: int = 0        # 涨停家数
    broke_count: int = 0     # 炸板家数(封板失败)
    max_boards: int = 0      # 最高连板
    ladder: list[Ladder] = []
    seal_rank: list[HotStock] = []   # 封板资金榜
    directions: list[HotSector] = []  # 资金方向(涨停行业聚合)
    movers: list[Mover] = []          # 放量涨幅榜
    sectors: list[HotSector] = []     # 领涨行业(新浪)
    updated: str = ""
    note: str = "客观行情统计,非荐股、不构成投资建议"


def _zt_pool():
    import akshare as ak

    cn_now = datetime.now(timezone.utc) + timedelta(hours=8)
    for back in range(0, 5):  # walk back to the latest trading day with data
        d = (cn_now - timedelta(days=back)).strftime("%Y%m%d")
        try:
            z = ak.stock_zt_pool_em(date=d)
            if z is not None and len(z) > 0:
                return z, d
        except Exception:
            continue
    return None, None


def _sectors() -> list[HotSector]:
    import akshare as ak

    try:
        df = ak.stock_sector_spot(indicator="新浪行业")
    except Exception as e:
        log.warning("hotspot sectors failed: %s", e)
        return []
    if df is None or df.empty:
        return []
    cols = list(df.columns)
    d = df.copy()
    d["_chg"] = d[cols[5]].map(_safe_float)
    d = d.sort_values("_chg", ascending=False).head(10)
    out: list[HotSector] = []
    for _, r in d.iterrows():
        chg = _safe_float(r[cols[5]])
        out.append(HotSector(
            name=str(r[cols[1]]),
            change_pct=(chg / 100) if chg is not None else None,
            amount=_safe_float(r[cols[7]]),
            leaders=[str(r[cols[12]])] if len(cols) > 12 and r[cols[12]] else [],
        ))
    return out


def _movers() -> list[Mover]:
    import pandas as pd

    df = get_cn_spot()
    if df is None or getattr(df, "empty", True):
        return []
    d = df.copy()
    d["_chg"] = pd.to_numeric(d["涨跌幅"], errors="coerce")
    d["_amt"] = pd.to_numeric(d["成交额"], errors="coerce")
    # 放量大涨:涨幅≥5%、成交额居前(过滤掉低流动性的拉升)
    d = d[(d["_chg"] >= 5) & (d["_amt"] > 0)].sort_values("_amt", ascending=False).head(20)
    out: list[Mover] = []
    for _, r in d.iterrows():
        import re
        code = re.sub(r"\D", "", str(r.get("代码"))) or str(r.get("代码"))
        out.append(Mover(code=code, name=str(r.get("名称")),
                         change_pct=(r["_chg"] / 100) if r["_chg"] == r["_chg"] else None,
                         amount=r["_amt"] if r["_amt"] == r["_amt"] else None))
    return out


def get_hotspot() -> Hotspot:
    global _CACHE
    if _CACHE and time.time() - _CACHE[0] < _TTL:
        return _CACHE[1]

    cn_now = datetime.now(timezone.utc) + timedelta(hours=8)
    hs = Hotspot(updated=cn_now.strftime("%H:%M"))

    z, d = _zt_pool()
    if z is not None:
        hs.date = f"{d[:4]}-{d[4:6]}-{d[6:]}" if d else None
        hs.zt_count = int(len(z))
        rows = []
        for _, r in z.iterrows():
            rows.append({
                "code": str(r.get("代码")), "name": str(r.get("名称")),
                "chg": _safe_float(r.get("涨跌幅")), "price": _safe_float(r.get("最新价")),
                "amount": _safe_float(r.get("成交额")), "turnover": _safe_float(r.get("换手率")),
                "seal": _safe_float(r.get("封板资金")), "boards": int(_safe_float(r.get("连板数")) or 1),
                "broke": int(_safe_float(r.get("炸板次数")) or 0), "ind": str(r.get("所属行业") or ""),
            })
        hs.broke_count = sum(1 for x in rows if x["broke"] > 0)
        hs.max_boards = max((x["boards"] for x in rows), default=0)
        # 连板梯队
        lad: dict[int, int] = {}
        for x in rows:
            lad[x["boards"]] = lad.get(x["boards"], 0) + 1
        hs.ladder = [Ladder(boards=b, count=c) for b, c in sorted(lad.items())]
        # 封板资金榜
        hs.seal_rank = [
            HotStock(code=x["code"], name=x["name"], change_pct=(x["chg"] / 100) if x["chg"] is not None else None,
                     price=x["price"], amount=x["amount"], turnover=x["turnover"],
                     seal_fund=x["seal"], boards=x["boards"], industry=x["ind"] or None)
            for x in sorted(rows, key=lambda y: (y["seal"] or 0), reverse=True)[:12]
        ]
        # 资金方向:涨停按行业聚合
        agg: dict[str, dict] = {}
        for x in rows:
            ind = x["ind"] or "其他"
            a = agg.setdefault(ind, {"n": 0, "seal": 0.0, "names": []})
            a["n"] += 1
            a["seal"] += (x["seal"] or 0)
            if len(a["names"]) < 4:
                a["names"].append(x["name"])
        hs.directions = [
            HotSector(name=k, limit_ups=v["n"], seal_fund=v["seal"], leaders=v["names"])
            for k, v in sorted(agg.items(), key=lambda kv: (kv[1]["n"], kv[1]["seal"]), reverse=True)[:8]
        ]

    try:
        hs.movers = _movers()
    except Exception as e:
        log.warning("hotspot movers failed: %s", e)
    hs.sectors = _sectors()

    _CACHE = (time.time(), hs)
    return hs
