"""Auth routes — register / login / me."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.services import auth, invites
from app.services.auth import User

router = APIRouter()


class Credentials(BaseModel):
    email: str = Field(..., min_length=3, max_length=200)
    password: str = Field(..., min_length=1, max_length=200)
    invite_code: str | None = Field(None, max_length=32)


class AuthResponse(BaseModel):
    token: str
    user: User


@router.post("/auth/register", response_model=AuthResponse)
def register(body: Credentials) -> AuthResponse:
    # The very first account (the owner) registers freely and becomes admin.
    # Everyone after must supply a valid invite code.
    first = auth.user_count() == 0
    if not first:
        if not body.invite_code or not invites.consume(body.invite_code):
            raise HTTPException(status_code=400, detail="邀请码无效或已用完")
    try:
        user = auth.create_user(body.email, body.password, is_admin=first)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    auth.grant_if_allowlisted(user.email)          # honor admin pre-authorization
    user = auth.get_user_by_id(user.id) or user    # reflect unlimited in the response
    return AuthResponse(token=auth.make_token(user.id, user.email), user=user)


@router.post("/auth/login", response_model=AuthResponse)
def login(body: Credentials) -> AuthResponse:
    user = auth.authenticate(body.email, body.password)
    if user is None:
        raise HTTPException(status_code=401, detail="账号或密码错误")
    return AuthResponse(token=auth.make_token(user.id, user.email), user=user)


@router.get("/auth/me", response_model=User)
def me(user: User = Depends(auth.get_current_user)) -> User:
    return user


@router.post("/auth/migrate-anon")
def migrate_anon(request: Request, user: User = Depends(auth.get_current_user)) -> dict:
    """Merge the browser's anonymous watchlist/paper data into this account."""
    anon = (request.headers.get("x-anon-id") or "").strip()
    if anon:
        auth.migrate_anon_to_user(anon, user.id)
    return {"ok": True}
