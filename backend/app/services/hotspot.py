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
import re
import threading
import time
from datetime import datetime, timedelta, timezone

from pydantic import BaseModel

from app.services import db
from app.services.market_data import _safe_float, get_cn_spot

log = logging.getLogger(__name__)

_CACHE: tuple[float, "Hotspot"] | None = None
_TTL = 90
_last_snap = 0.0        # throttle the daily snapshot upsert (per process)
_SNAP_EVERY = 1800      # at most once / 30 min

# Real net-flow Sankeys (个股净流入 + 新浪行业映射) — heavy (~20s), so cached with
# background refresh; the /api/hotspot request never blocks on it.
_FLOW_CACHE: tuple[float, tuple] | None = None
_FLOW_TTL = 180
_flow_lock = threading.Lock()
_flow_refreshing = False
_IND_MAP: tuple[float, dict] | None = None
_IND_MAP_TTL = 86400


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
    days: int = 0                   # 连续在榜天数(热点持续性)


class Accel(BaseModel):
    code: str
    name: str
    change_pct: float | None = None
    amount: float | None = None     # 今日成交额 元
    ratio: float | None = None      # 今日额 / 近数日均额(量能加速倍数)


class FundFlow(BaseModel):
    """真·资金流向(同花顺):行业/概念的主力净流入,单位亿元。"""
    name: str
    net: float | None = None        # 净额 亿元(正=净流入)
    inflow: float | None = None     # 流入资金 亿元
    change_pct: float | None = None # decimal
    leader: str | None = None
    num: int | None = None


class SankeyNode(BaseModel):
    name: str
    kind: str = ""   # root / industry / stock


class SankeyLink(BaseModel):
    source: int
    target: int
    value: float     # 亿元


class Sankey(BaseModel):
    nodes: list[SankeyNode] = []
    links: list[SankeyLink] = []


class FlowStock(BaseModel):
    """个股真实净流入(同花顺·即时),下钻明细用。"""
    code: str
    name: str
    net: float | None = None          # 亿元(正=净流入)
    price: float | None = None
    change_pct: float | None = None   # decimal


class FlowIndustry(BaseModel):
    name: str
    net: float = 0.0                  # 行业净额合计 亿元
    count: int = 0                    # 该行业参与统计的个股数
    stocks: list[FlowStock] = []      # 按净额降序;过长时保留头部流入+尾部流出


class FlowDrill(BaseModel):
    industries: list[FlowIndustry] = []
    updated: str = ""
    note: str = "真实个股净流入(同花顺·即时)按新浪行业聚合,约 3 分钟更新;客观统计,非荐股"


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
    accel: list[Accel] = []           # 量能加速榜
    accel_days: int = 0               # 已积累的历史天数(不足则加速榜为空)
    flow_industry: list[FundFlow] = []  # 行业资金净流入榜(同花顺)
    flow_concept: list[FundFlow] = []   # 概念/题材资金净流入榜(同花顺)
    sankey_in: Sankey | None = None   # 今日资金流入 → 行业 → 个股(真实净流入,守恒)
    sankey_out: Sankey | None = None  # 今日资金流出 → 行业 → 个股
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


def _movers(df) -> list[Mover]:
    import pandas as pd

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


def _norm_code(c: str) -> str:
    import re
    return re.sub(r"\D", "", str(c)) or str(c)


def _snapshot(date: str, df, directions: list[HotSector]) -> None:
    """Upsert today's per-stock turnover + mainline sectors (throttled). Prunes
    to a ~10-trading-day rolling window."""
    global _last_snap
    if not date or df is None or getattr(df, "empty", True):
        return
    if time.time() - _last_snap < _SNAP_EVERY:
        return
    import pandas as pd
    try:
        d = df.copy()
        d["_amt"] = pd.to_numeric(d["成交额"], errors="coerce")
        rows = [(date, _norm_code(r.get("代码")), float(r["_amt"]))
                for _, r in d.iterrows() if r["_amt"] == r["_amt"] and r["_amt"] > 0]
        db.executemany(
            "INSERT INTO spot_snap (date, code, amount) VALUES (?, ?, ?) "
            "ON CONFLICT(date, code) DO UPDATE SET amount = excluded.amount", rows)
        for x in directions:
            db.execute(
                "INSERT INTO mainline_snap (date, industry, limit_ups) VALUES (?, ?, ?) "
                "ON CONFLICT(date, industry) DO UPDATE SET limit_ups = excluded.limit_ups",
                (date, x.name, x.limit_ups))
        # prune to the most recent ~10 stored dates
        keep = [r["date"] for r in db.query_all("SELECT DISTINCT date FROM spot_snap ORDER BY date DESC LIMIT 10")]
        if keep:
            floor = keep[-1]
            db.execute("DELETE FROM spot_snap WHERE date < ?", (floor,))
            db.execute("DELETE FROM mainline_snap WHERE date < ?", (floor,))
        _last_snap = time.time()
    except Exception as e:
        log.warning("hotspot snapshot failed: %s", e)


def _accel(date: str, df) -> tuple[list[Accel], int]:
    """量能加速榜:今日成交额 / 近数日均额。需要≥3 个历史交易日才出榜。"""
    if not date or df is None or getattr(df, "empty", True):
        return [], 0
    import pandas as pd
    ndays = len({r["date"] for r in db.query_all("SELECT DISTINCT date FROM spot_snap WHERE date < ?", (date,))})
    if ndays < 3:
        return [], ndays
    prior = {r["code"]: (r["a"], r["n"]) for r in db.query_all(
        "SELECT code, AVG(amount) AS a, COUNT(DISTINCT date) AS n FROM spot_snap WHERE date < ? GROUP BY code", (date,))}
    d = df.copy()
    d["_amt"] = pd.to_numeric(d["成交额"], errors="coerce")
    d["_chg"] = pd.to_numeric(d["涨跌幅"], errors="coerce")
    out: list[Accel] = []
    for _, r in d.iterrows():
        amt = r["_amt"]
        if amt != amt or amt < 1e8:  # skip low-liquidity (<1亿)
            continue
        code = _norm_code(r.get("代码"))
        p = prior.get(code)
        if not p or p[1] < 3 or not p[0]:
            continue
        ratio = amt / p[0]
        if ratio < 1.5:  # only "accelerating" names
            continue
        out.append(Accel(code=code, name=str(r.get("名称")),
                         change_pct=(r["_chg"] / 100) if r["_chg"] == r["_chg"] else None,
                         amount=float(amt), ratio=round(float(ratio), 2)))
    out.sort(key=lambda x: (x.ratio or 0), reverse=True)
    return out[:20], ndays


def _apply_streaks(directions: list[HotSector], date: str) -> None:
    """给每个当前主线行业标注"连续在榜天数"(含今日)。"""
    if not date:
        return
    rows = db.query_all("SELECT date, industry FROM mainline_snap WHERE date <= ? ORDER BY date DESC", (date,))
    dates = sorted({r["date"] for r in rows}, reverse=True)  # newest first, incl today
    by_date: dict[str, set] = {}
    for r in rows:
        by_date.setdefault(r["date"], set()).add(r["industry"])
    for x in directions:
        streak = 0
        for dt in dates:
            if x.name in by_date.get(dt, set()):
                streak += 1
            else:
                break
        x.days = streak if streak else 1  # today counts even before it's persisted


def _fund_flow() -> tuple[list[FundFlow], list[FundFlow]]:
    """真·资金流向(同花顺,VPS 可达):行业 + 概念的主力净流入(亿元)。"""
    import akshare as ak
    import pandas as pd

    def top(fn, n: int = 12) -> list[FundFlow]:
        try:
            df = fn()
        except Exception as e:
            log.warning("fund flow fetch failed: %s", e)
            return []
        if df is None or getattr(df, "empty", True) or "净额" not in df.columns:
            return []
        d = df.copy()
        d["_net"] = pd.to_numeric(d["净额"], errors="coerce")
        d = d.sort_values("_net", ascending=False).head(n)
        out: list[FundFlow] = []
        for _, r in d.iterrows():
            chg = _safe_float(r.get("行业-涨跌幅"))
            out.append(FundFlow(
                name=str(r.get("行业")),
                net=_safe_float(r.get("净额")),
                inflow=_safe_float(r.get("流入资金")),
                change_pct=(chg / 100) if chg is not None else None,
                leader=str(r.get("领涨股") or "") or None,
                num=int(_safe_float(r.get("公司家数")) or 0) or None,
            ))
        return out

    ind = top(lambda: ak.stock_fund_flow_industry(symbol="即时"))
    con = top(lambda: ak.stock_fund_flow_concept(symbol="即时"))
    return ind, con


def _parse_money(s) -> float | None:
    """'1.08亿'→1.08, '941.88万'→0.0094, '-5.2亿'→-5.2, '123456'(元)→0.0012 —— 单位亿元。"""
    s = str(s).strip().replace(",", "")
    if not s or s in ("-", "nan", "None"):
        return None
    neg = s.startswith("-")
    s = s.lstrip("-+")
    try:
        if s.endswith("亿"):
            v = float(s[:-1])
        elif s.endswith("万"):
            v = float(s[:-1]) / 1e4
        else:
            v = float(s) / 1e8
    except ValueError:
        return None
    return -v if neg else v


def _industry_map() -> dict:
    """{股票代码: 新浪行业名};遍历新浪行业成分(可达),缓存 24h。"""
    global _IND_MAP
    if _IND_MAP and time.time() - _IND_MAP[0] < _IND_MAP_TTL:
        return _IND_MAP[1]
    import akshare as ak

    m: dict[str, str] = {}
    try:
        sp = ak.stock_sector_spot(indicator="新浪行业")
        cols = list(sp.columns)
        for _, r in sp.iterrows():
            label, ind = str(r[cols[0]]), str(r[cols[1]])
            try:
                d = ak.stock_sector_detail(sector=label)
                for code in d["code"]:
                    m[re.sub(r"\D", "", str(code))] = ind
            except Exception:
                continue
    except Exception as e:
        log.warning("industry map failed: %s", e)
    if m:
        _IND_MAP = (time.time(), m)
    return m


def _build_flow_sankeys() -> tuple["Sankey | None", "Sankey | None", "FlowDrill | None"]:
    import akshare as ak

    imap = _industry_map()
    if not imap:
        return None, None, None
    df = ak.stock_fund_flow_individual(symbol="即时")  # ~18s, all A-shares net flow
    ind_net: dict[str, float] = {}
    ind_stocks: dict[str, list[FlowStock]] = {}
    for _, r in df.iterrows():
        code = re.sub(r"\D", "", str(r.get("股票代码")))
        ind = imap.get(code)
        net = _parse_money(r.get("净额"))
        if not ind or net is None:
            continue
        chg = _safe_float(str(r.get("涨跌幅")).replace("%", ""))  # THS 返回 "20.02%" 字符串
        ind_net[ind] = ind_net.get(ind, 0.0) + net
        ind_stocks.setdefault(ind, []).append(FlowStock(
            code=code, name=str(r.get("股票简称")), net=round(net, 2),
            price=_safe_float(r.get("最新价")),
            change_pct=(chg / 100) if chg is not None else None,
        ))

    def build(direction: int) -> "Sankey | None":
        root = "今日资金流入" if direction > 0 else "今日资金流出"
        inds = [(i, v) for i, v in ind_net.items() if v * direction > 0]
        inds.sort(key=lambda kv: kv[1] * direction, reverse=True)
        nodes = [SankeyNode(name=root, kind="root")]
        links: list[SankeyLink] = []
        for ind, _ in inds[:7]:
            stocks = [s for s in ind_stocks[ind] if (s.net or 0) * direction > 0]
            stocks.sort(key=lambda s: (s.net or 0) * direction, reverse=True)
            stocks = stocks[:3]
            if not stocks:
                continue
            ii = len(nodes)
            nodes.append(SankeyNode(name=ind, kind="industry"))
            links.append(SankeyLink(source=0, target=ii, value=round(sum(abs(s.net or 0) for s in stocks), 2)))
            for s in stocks:
                si = len(nodes)
                nodes.append(SankeyNode(name=s.name, kind="stock"))
                links.append(SankeyLink(source=ii, target=si, value=round(abs(s.net or 0), 2)))
        return Sankey(nodes=nodes, links=links) if len(nodes) > 1 else None

    # 完整下钻:每个行业按净额降序;过长时保留最强流入 14 只 + 最强流出 10 只。
    cn_now = datetime.now(timezone.utc) + timedelta(hours=8)
    industries: list[FlowIndustry] = []
    for name, net in sorted(ind_net.items(), key=lambda kv: kv[1], reverse=True):
        stocks = sorted(ind_stocks[name], key=lambda s: s.net or 0, reverse=True)
        total = len(stocks)
        if total > 24:
            stocks = stocks[:14] + stocks[-10:]
        industries.append(FlowIndustry(name=name, net=round(net, 2), count=total, stocks=stocks))
    drill = FlowDrill(industries=industries, updated=cn_now.strftime("%H:%M")) if industries else None

    return build(1), build(-1), drill


def _refresh_flow() -> None:
    global _FLOW_CACHE, _flow_refreshing
    try:
        _FLOW_CACHE = (time.time(), _build_flow_sankeys())
    except Exception as e:
        log.warning("flow sankeys failed: %s", e)
    finally:
        _flow_refreshing = False


def _get_flow_sankeys() -> tuple["Sankey | None", "Sankey | None", "FlowDrill | None"]:
    global _flow_refreshing
    now = time.time()
    if _FLOW_CACHE and now - _FLOW_CACHE[0] < _FLOW_TTL:
        return _FLOW_CACHE[1]
    if _FLOW_CACHE:  # stale → serve stale, refresh in background (non-blocking)
        with _flow_lock:
            if not _flow_refreshing:
                _flow_refreshing = True
                threading.Thread(target=_refresh_flow, daemon=True).start()
        return _FLOW_CACHE[1]
    # cold → build synchronously in this worker thread (akshare works here, like
    # _fund_flow); ~20s the first time only, then cached.
    with _flow_lock:
        if _FLOW_CACHE:
            return _FLOW_CACHE[1]
        _flow_refreshing = True
    _refresh_flow()
    return _FLOW_CACHE[1] if _FLOW_CACHE else (None, None, None)


def get_flow_drill() -> FlowDrill:
    """行业 → 个股 真实净流入下钻(与桑基图共享同一份缓存)。"""
    drill = _get_flow_sankeys()[2]
    return drill or FlowDrill()


def warm_flow() -> None:
    """Prime the net-flow Sankeys at startup (heavy: industry map + individual flow)."""
    global _flow_refreshing
    _flow_refreshing = True
    _refresh_flow()


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

    spot = None
    try:
        spot = get_cn_spot()
    except Exception as e:
        log.warning("hotspot spot failed: %s", e)
    try:
        hs.movers = _movers(spot)
    except Exception as e:
        log.warning("hotspot movers failed: %s", e)
    hs.sectors = _sectors()
    try:
        hs.flow_industry, hs.flow_concept = _fund_flow()
    except Exception as e:
        log.warning("hotspot fund flow failed: %s", e)
    try:
        hs.sankey_in, hs.sankey_out, _ = _get_flow_sankeys()
    except Exception as e:
        log.warning("hotspot flow sankeys failed: %s", e)

    # History-backed features: 量能加速 + 主线持续天数 (bootstraps over days).
    try:
        _snapshot(hs.date, spot, hs.directions)
        hs.accel, hs.accel_days = _accel(hs.date, spot)
        _apply_streaks(hs.directions, hs.date)
    except Exception as e:
        log.warning("hotspot history failed: %s", e)

    _CACHE = (time.time(), hs)
    return hs
