"""WeChat push via third-party relays (Server酱 / PushPlus).

These let us push to a user's WeChat without running our own 公众号: the user
registers, binds WeChat, gets a key, and pastes it into the app. We just POST.
Reachable from the mainland VPS (both are China services).
"""
from __future__ import annotations

import logging

import httpx

log = logging.getLogger(__name__)

PROVIDERS = ("serverchan", "pushplus")


def send_push(provider: str, key: str, title: str, body: str) -> tuple[bool, str]:
    """Returns (ok, detail). Never raises."""
    key = (key or "").strip()
    if not key:
        return False, "缺少推送 key"
    try:
        with httpx.Client(trust_env=False, timeout=12) as c:
            if provider == "serverchan":
                # Server酱 Turbo: https://sctapi.ftqq.com/<SENDKEY>.send
                r = c.post(f"https://sctapi.ftqq.com/{key}.send", data={"title": title[:32], "desp": body})
                j = _json(r)
                ok = r.status_code == 200 and j.get("code") in (0, "0")
                return ok, (j.get("message") or j.get("info") or str(r.status_code))
            if provider == "pushplus":
                r = c.post("https://www.pushplus.plus/send", json={
                    "token": key, "title": title[:100], "content": body, "template": "txt",
                })
                j = _json(r)
                ok = r.status_code == 200 and str(j.get("code")) == "200"
                return ok, (j.get("msg") or str(r.status_code))
            return False, f"未知渠道: {provider}"
    except Exception as e:
        log.warning("push failed (%s): %s", provider, e)
        return False, str(e)[:120]


def _json(r) -> dict:
    try:
        return r.json()
    except Exception:
        return {}
