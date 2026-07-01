"""Admin dashboard routes — invite codes + analytics. All require an admin."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.services import app_settings, events, invites
from app.services import feedback as fb
from app.services.auth import User, get_current_admin
from app.services.rate_limit import _parse

router = APIRouter()


class CreateInvites(BaseModel):
    count: int = Field(1, ge=1, le=100)
    note: str = Field("", max_length=100)
    max_uses: int = Field(1, ge=1, le=1000)


class RateLimits(BaseModel):
    limit_quick_anon: str = Field(..., max_length=16)
    limit_debate_anon: str = Field(..., max_length=16)
    limit_debate_user: str = Field(..., max_length=16)


@router.get("/admin/settings", response_model=RateLimits)
def get_settings_admin(user: User = Depends(get_current_admin)) -> RateLimits:
    return RateLimits(**app_settings.all_settings())


@router.post("/admin/settings", response_model=RateLimits)
def set_settings_admin(body: RateLimits, user: User = Depends(get_current_admin)) -> RateLimits:
    values = body.model_dump()
    for k, v in values.items():
        try:
            _parse(v)  # validate "<N>/<period>" before persisting
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"{k}: {e}") from e
    app_settings.set_many(values)
    return RateLimits(**app_settings.all_settings())


@router.get("/admin/invites", response_model=list[invites.InviteCode])
def list_invites(user: User = Depends(get_current_admin)) -> list[invites.InviteCode]:
    return invites.list_codes()


@router.post("/admin/invites", response_model=list[invites.InviteCode])
def create_invites(body: CreateInvites, user: User = Depends(get_current_admin)) -> list[invites.InviteCode]:
    return invites.create_codes(body.count, body.note, body.max_uses)


@router.delete("/admin/invites/{code}")
def revoke_invite(code: str, user: User = Depends(get_current_admin)) -> dict:
    if not invites.revoke(code):
        raise HTTPException(status_code=404, detail="邀请码不存在")
    return {"ok": True}


@router.get("/admin/stats", response_model=events.Stats)
def admin_stats(user: User = Depends(get_current_admin)) -> events.Stats:
    return events.get_stats()


@router.get("/admin/paths", response_model=list[events.SessionPath])
def admin_paths(user: User = Depends(get_current_admin)) -> list[events.SessionPath]:
    return events.recent_paths()


@router.get("/admin/feedback", response_model=list[fb.Feedback])
def admin_feedback(user: User = Depends(get_current_admin)) -> list[fb.Feedback]:
    return fb.list_feedback()
