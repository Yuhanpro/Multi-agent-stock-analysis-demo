"""Background price-alert engine.

A daemon thread polls the A-share spot table during CN trading hours, evaluates
each user's enabled rules, and pushes to WeChat (Server酱 / PushPlus) on a hit.
Single worker + the db lock keep it simple; a per-alert cooldown avoids spam.

MVP scope: A-shares only (Sina realtime is reliable from the VPS; US/HK are
day-level here, so their alerts are stored but not yet fired).
"""
from __future__ import annotations

import logging
import re
import threading
import time
from datetime import datetime, timedelta, timezone

from app.services import alerts as alerts_svc
from app.services.push import send_push

log = logging.getLogger(__name__)

_CHECK_INTERVAL = 120  # seconds between sweeps
_COOLDOWN_MIN = 120    # min minutes between two pushes for the same alert


def _beijing_now() -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=8)


def _cn_trading(now: datetime) -> bool:
    if now.weekday() >= 5:
        return False
    hm = now.hour * 60 + now.minute
    return (9 * 60 + 25 <= hm <= 11 * 60 + 35) or (12 * 60 + 55 <= hm <= 15 * 60 + 5)


def _cn_prices() -> dict[str, tuple[float | None, float | None, str]]:
    """6-digit code -> (price, change_pct_decimal, name)."""
    from app.services.market_data import _pct, _safe_float, get_cn_spot

    out: dict[str, tuple[float | None, float | None, str]] = {}
    df = get_cn_spot()
    if df is None or getattr(df, "empty", True):
        return out
    for _, r in df.iterrows():
        code = re.sub(r"\D", "", str(r.get("代码")))
        if not code:
            continue
        out[code] = (_safe_float(r.get("最新价")), _pct(r.get("涨跌幅")), str(r.get("名称")))
    return out


def _hit_reason(a: dict, price: float, chg_pct: float | None) -> str | None:
    if a["up_pct"] is not None and chg_pct is not None and chg_pct >= a["up_pct"]:
        return f"涨幅达 {chg_pct:+.2f}%(阈值 +{a['up_pct']:.1f}%)"
    if a["down_pct"] is not None and chg_pct is not None and chg_pct <= -a["down_pct"]:
        return f"跌幅达 {chg_pct:+.2f}%(阈值 -{a['down_pct']:.1f}%)"
    if a["target_above"] is not None and price >= a["target_above"]:
        return f"价格 {price} 已突破目标价 {a['target_above']}"
    if a["target_below"] is not None and price <= a["target_below"]:
        return f"价格 {price} 已跌破止损价 {a['target_below']}"
    return None


def evaluate_once() -> int:
    """One sweep. Returns the number of pushes sent (handy for testing)."""
    rows = [a for a in alerts_svc.active_alerts_with_push() if a["market"] == "CN"]
    if not rows:
        return 0
    prices = _cn_prices()
    if not prices:
        return 0
    now = datetime.now(timezone.utc)
    sent = 0
    for a in rows:
        code = re.sub(r"\D", "", str(a["ticker"]))
        p = prices.get(code)
        if not p or p[0] is None:
            continue
        price, chg, name = p
        if a["last_fired_at"]:
            try:
                if (now - datetime.fromisoformat(a["last_fired_at"])).total_seconds() < _COOLDOWN_MIN * 60:
                    continue
            except Exception:
                pass
        chg_pct = chg * 100 if chg is not None else None
        reason = _hit_reason(a, price, chg_pct)
        if not reason:
            continue
        title = f"{name}({code}) 价格提醒"
        body = f"{name}({code}) 当前 {price}\n{reason}\n\n— stock-web 自选提醒"
        ok, detail = send_push(a["push_provider"], a["push_key"], title, body)
        if ok:
            alerts_svc.mark_fired(a["id"])
            sent += 1
        else:
            log.warning("alert push to user %s failed: %s", a["user_id"], detail)
    return sent


def _loop() -> None:
    while True:
        try:
            if _cn_trading(_beijing_now()):
                evaluate_once()
        except Exception as e:
            log.warning("alert scheduler sweep failed: %s", e)
        time.sleep(_CHECK_INTERVAL)


def start() -> None:
    threading.Thread(target=_loop, daemon=True).start()
    log.info("price-alert scheduler started (CN realtime, %ds sweep)", _CHECK_INTERVAL)
