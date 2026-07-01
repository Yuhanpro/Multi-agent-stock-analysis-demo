"""Admin-editable runtime settings (rate limits), backed by the app_settings
key/value table so they can be changed from the dashboard without a redeploy.

Rate-limit values use the limiter's "<N>/<period>" format. The special value
"unlimited" means no cap (used for signed-in users on quick-scope endpoints,
which is enforced in the routes, not stored here)."""
from __future__ import annotations

from app.services import db

# key -> (default, human label). Signed-in quick/serenity is unlimited and not a
# stored knob; these are the caps the admin can actually tune.
DEFAULTS: dict[str, str] = {
    "limit_quick_anon": "5/hour",    # anonymous 速评/Serenity/追问/基金/黄金
    "limit_debate_anon": "1/hour",   # anonymous 多智能体辩论
    "limit_debate_user": "1/hour",   # signed-in 多智能体辩论 (admin-controlled)
}


def get(key: str) -> str:
    row = db.query_one("SELECT value FROM app_settings WHERE key = ?", (key,))
    if row and row["value"]:
        return row["value"]
    return DEFAULTS.get(key, "")


def all_settings() -> dict[str, str]:
    return {k: get(k) for k in DEFAULTS}


def set_many(values: dict[str, str]) -> None:
    for key, value in values.items():
        if key not in DEFAULTS:
            continue
        db.execute(
            "INSERT INTO app_settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, str(value).strip()),
        )
