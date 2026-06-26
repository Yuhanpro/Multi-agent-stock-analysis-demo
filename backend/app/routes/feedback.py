"""POST /api/feedback — anyone (signed-in or not) can leave a suggestion."""
from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.config import get_settings
from app.services import auth
from app.services import feedback as fb
from app.services.rate_limit import check_and_count

log = logging.getLogger(__name__)

router = APIRouter()


class FeedbackBody(BaseModel):
    content: str = Field(..., min_length=1, max_length=4000)
    category: Literal["suggestion", "feature", "bug", "other"] = "suggestion"
    contact: str | None = Field(None, max_length=120)
    anon_id: str | None = Field(None, max_length=64)
    path: str | None = Field(None, max_length=200)


@router.post("/feedback")
def submit_feedback(body: FeedbackBody, request: Request) -> dict:
    get_settings()
    # Light anti-spam: cap submissions per IP.
    check_and_count(request, scope="feedback", limit="30/hour")
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="内容不能为空")

    user = auth.user_from_request(request)
    item = fb.create_feedback(
        content=body.content,
        category=body.category,
        contact=(body.contact or None),
        email=user.email if user else None,
        user_id=user.id if user else None,
        anon_id=body.anon_id,
        path=body.path,
    )
    return {"ok": True, "id": item.id}
