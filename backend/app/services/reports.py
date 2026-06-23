"""Saved analysis reports (per user), backed by SQLite.

A report is the full markdown produced by a Quick / Serenity / Debate run plus
a little metadata. The SSE routes accumulate the streamed output and call
`save_report` once the run finishes, but only when the request is authenticated.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone

from pydantic import BaseModel

from app.services import db

# Order matters: longer / more specific signals first.
_SIGNALS = [
    ("强烈买入", "BUY"), ("买入", "BUY"), ("增持", "BUY"), ("BUY", "BUY"), ("STRONG BUY", "BUY"),
    ("强烈卖出", "SELL"), ("卖出", "SELL"), ("减持", "SELL"), ("SELL", "SELL"),
    ("持有", "HOLD"), ("观望", "HOLD"), ("中性", "HOLD"), ("HOLD", "HOLD"),
]


class ReportMeta(BaseModel):
    id: str
    ticker: str
    market: str
    mode: str
    language: str
    title: str
    decision: str | None = None
    cost_usd: float = 0.0
    created_at: str


class Report(ReportMeta):
    content: str


def extract_signal(text: str | None) -> str | None:
    """Best-effort BUY/SELL/HOLD pulled from a report. The frontend does its own
    richer parsing for display; this is just for the list-view pill."""
    if not text:
        return None
    head = text[:600].upper()
    head_zh = text[:600]
    for needle, sig in _SIGNALS:
        if needle.isascii():
            if needle in head:
                return sig
        elif needle in head_zh:
            return sig
    return None


def _mode_label(mode: str, language: str) -> str:
    zh = language == "zh"
    return {
        "quick": "巴菲特速评" if zh else "Buffett Quick",
        "serenity": "Serenity 产业链" if zh else "Serenity Chain",
        "debate": "多智能体辩论" if zh else "Multi-Agent Debate",
    }.get(mode, mode)


def _row_to_meta(row) -> ReportMeta:
    return ReportMeta(
        id=row["id"], ticker=row["ticker"], market=row["market"], mode=row["mode"],
        language=row["language"], title=row["title"], decision=row["decision"],
        cost_usd=row["cost_usd"], created_at=row["created_at"],
    )


def save_report(
    user_id: int,
    *,
    ticker: str,
    market: str,
    mode: str,
    language: str,
    content: str,
    decision: str | None = None,
    cost_usd: float = 0.0,
) -> ReportMeta:
    rid = uuid.uuid4().hex
    created_at = datetime.now(timezone.utc).isoformat()
    title = f"{ticker} · {_mode_label(mode, language)}"
    if decision is None:
        decision = extract_signal(content)
    db.execute(
        """INSERT INTO reports
           (id, user_id, ticker, market, mode, language, title, decision, content, cost_usd, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (rid, user_id, ticker, market, mode, language, title, decision, content, float(cost_usd or 0), created_at),
    )
    return ReportMeta(
        id=rid, ticker=ticker, market=market, mode=mode, language=language,
        title=title, decision=decision, cost_usd=float(cost_usd or 0), created_at=created_at,
    )


def list_reports(user_id: int) -> list[ReportMeta]:
    rows = db.query_all(
        """SELECT id, ticker, market, mode, language, title, decision, cost_usd, created_at
           FROM reports WHERE user_id = ? ORDER BY created_at DESC""",
        (user_id,),
    )
    return [_row_to_meta(r) for r in rows]


def get_report(user_id: int, report_id: str) -> Report | None:
    row = db.query_one("SELECT * FROM reports WHERE id = ? AND user_id = ?", (report_id, user_id))
    if row is None:
        return None
    return Report(
        id=row["id"], ticker=row["ticker"], market=row["market"], mode=row["mode"],
        language=row["language"], title=row["title"], decision=row["decision"],
        cost_usd=row["cost_usd"], created_at=row["created_at"], content=row["content"],
    )


def delete_report(user_id: int, report_id: str) -> bool:
    cur = db.execute("DELETE FROM reports WHERE id = ? AND user_id = ?", (report_id, user_id))
    return cur.rowcount > 0
