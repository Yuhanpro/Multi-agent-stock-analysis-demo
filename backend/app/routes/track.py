"""POST /api/track — record a page view (anon id + path, optional user)."""
from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.services import auth, events

router = APIRouter()


class TrackBody(BaseModel):
    anon_id: str = Field(..., min_length=1, max_length=64)
    path: str = Field(..., min_length=1, max_length=200)


@router.post("/track")
def track(body: TrackBody, request: Request) -> dict:
    user = auth.user_from_request(request)
    try:
        events.log_event(body.anon_id, body.path, user.id if user else None)
    except Exception:
        pass  # never let tracking break navigation
    return {"ok": True}
