"""Admin dashboard routes — invite codes + analytics. All require an admin."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.services import events, invites
from app.services.auth import User, get_current_admin

router = APIRouter()


class CreateInvites(BaseModel):
    count: int = Field(1, ge=1, le=100)
    note: str = Field("", max_length=100)
    max_uses: int = Field(1, ge=1, le=1000)


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
