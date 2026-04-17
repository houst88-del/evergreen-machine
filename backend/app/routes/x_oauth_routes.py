from __future__ import annotations

import os

import tweepy
from fastapi import APIRouter, Cookie, Header, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from app.core.db import SessionLocal
from app.core.security import verify_token
from app.models.models import AutopilotStatus, ConnectedAccount, User
from app.services.secret_crypto import encrypt_metadata, encrypt_secret

router = APIRouter(prefix="/api/providers/x", tags=["providers"])


def oauth_config():
    api_key = os.getenv("X_API_KEY", "").strip()
    api_secret = os.getenv("X_API_SECRET", "").strip()
    callback = os.getenv(
        "X_CALLBACK_URL",
        "https://backend-fixed-production.up.railway.app/api/providers/x/callback",
    ).strip()

    if not api_key or not api_secret:
        raise HTTPException(status_code=500, detail="Missing X_API_KEY or X_API_SECRET")

    return api_key, api_secret, callback


def dashboard_redirect_url() -> str:
    return os.getenv(
        "EVERGREEN_DASHBOARD_URL",
        "http://127.0.0.1:3000/dashboard",
    ).strip()


def resolve_user_id_from_auth_header(authorization: str | None) -> int:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    token = authorization.split(" ", 1)[1].strip()
    payload = verify_token(token)
    if not payload or not payload.get("user_id"):
        raise HTTPException(status_code=401, detail="Invalid auth token")

    return int(payload["user_id"])


def get_or_create_account_scoped_autopilot(db, user: User, account: ConnectedAccount) -> AutopilotStatus:
    autopilot = (
        db.query(AutopilotStatus)
        .filter(AutopilotStatus.connected_account_id == account.id)
        .first()
    )

    if not autopilot:
        autopilot = AutopilotStatus(
            user_id=user.id,
            connected_account_id=account.id,
            enabled=False,
            connected=(account.connection_status == "connected"),
            provider="x",
            posts_in_rotation=0,
        )
        db.add(autopilot)
        db.flush()
    else:
        autopilot.connected = account.connection_status == "connected"
        autopilot.provider = "x"

    return autopilot


def save_or_update_x_account(
    *,
    user_id: int,
    provider_account_id: str,
    handle: str,
    access_token: str,
    access_token_secret: str,
    api_key: str,
    api_secret: str,
) -> int:
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail=f"User {user_id} not found")

        account = (
            db.query(ConnectedAccount)
            .filter(
                ConnectedAccount.user_id == user.id,
                ConnectedAccount.provider == "x",
            )
            .order_by(ConnectedAccount.id.asc())
            .first()
        )

        metadata = encrypt_metadata(
            {
                "api_key": api_key,
                "api_secret": api_secret,
                "access_token_secret": access_token_secret,
                "source": "x_oauth",
            }
        )

        encrypted_access_token = encrypt_secret(access_token)
        encrypted_access_token_secret = encrypt_secret(access_token_secret)

        if not account:
            account = ConnectedAccount(
                user_id=user.id,
                provider="x",
                provider_account_id=provider_account_id,
                handle=handle,
                access_token=encrypted_access_token,
                access_token_secret=encrypted_access_token_secret,
                refresh_token=None,
                token_expires_at=None,
                connection_status="connected",
                metadata_json=metadata,
            )
            db.add(account)
            db.flush()
        else:
            account.provider_account_id = provider_account_id
            account.handle = handle
            account.access_token = encrypted_access_token
            account.access_token_secret = encrypted_access_token_secret
            account.refresh_token = None
            account.token_expires_at = None
            account.connection_status = "connected"
            account.metadata_json = metadata

        autopilot = get_or_create_account_scoped_autopilot(db, user, account)
        autopilot.connected = True
        autopilot.provider = "x"

        db.commit()
        db.refresh(account)
        db.refresh(autopilot)
        return int(account.id)
    finally:
        db.close()


@router.get("/start")
def start_oauth(authorization: str | None = Header(default=None)):
    api_key, api_secret, callback = oauth_config()
    user_id = resolve_user_id_from_auth_header(authorization)

    auth = tweepy.OAuth1UserHandler(
        api_key,
        api_secret,
        callback=callback,
    )

    try:
        authorization_url = auth.get_authorization_url(signin_with_twitter=True)
        request_token = getattr(auth, "request_token", None)
        if not request_token:
            raise HTTPException(status_code=500, detail="Failed to store X request token")

        oauth_token = request_token.get("oauth_token")
        oauth_token_secret = request_token.get("oauth_token_secret")
        if not oauth_token or not oauth_token_secret:
            raise HTTPException(status_code=500, detail="Missing oauth request token or secret")

        response = RedirectResponse(url=authorization_url, status_code=302)
        response.set_cookie(
            key="x_oauth_request_secret",
            value=oauth_token_secret,
            httponly=True,
            secure=True,
            samesite="lax",
            max_age=600,
            path="/",
        )
        response.set_cookie(
            key="x_oauth_request_token",
            value=oauth_token,
            httponly=True,
            secure=True,
            samesite="lax",
            max_age=600,
            path="/",
        )
        response.set_cookie(
            key="x_oauth_user_id",
            value=str(user_id),
            httponly=True,
            secure=True,
            samesite="lax",
            max_age=600,
            path="/",
        )
        return response
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to start X OAuth: {exc}")


@router.get("/callback", response_class=HTMLResponse)
def oauth_callback(
    request: Request,
    x_oauth_request_secret: str | None = Cookie(default=None),
    x_oauth_request_token: str | None = Cookie(default=None),
    x_oauth_user_id: str | None = Cookie(default=None),
):
    oauth_token = str(request.query_params.get("oauth_token", "")).strip()
    oauth_verifier = str(request.query_params.get("oauth_verifier", "")).strip()

    if not oauth_token or not oauth_verifier:
        raise HTTPException(status_code=400, detail="Missing oauth_token or oauth_verifier")
    if not x_oauth_request_secret or not x_oauth_request_token:
        raise HTTPException(status_code=400, detail="Missing OAuth request cookie")
    if oauth_token != x_oauth_request_token:
        raise HTTPException(status_code=400, detail="OAuth token mismatch")
    if not x_oauth_user_id or not x_oauth_user_id.isdigit():
        raise HTTPException(status_code=400, detail="Missing OAuth user cookie")

    api_key, api_secret, callback = oauth_config()
    auth = tweepy.OAuth1UserHandler(api_key, api_secret, callback=callback)
    auth.request_token = {
        "oauth_token": oauth_token,
        "oauth_token_secret": x_oauth_request_secret,
    }

    try:
        access_token, access_token_secret = auth.get_access_token(oauth_verifier)

        client = tweepy.Client(
            consumer_key=api_key,
            consumer_secret=api_secret,
            access_token=access_token,
            access_token_secret=access_token_secret,
        )
        me = client.get_me(user_auth=True)
        user_obj = getattr(me, "data", None)
        if user_obj is None:
            raise HTTPException(status_code=500, detail="Failed to fetch authenticated X user")

        provider_account_id = str(getattr(user_obj, "id", "") or "").strip()
        username = str(getattr(user_obj, "username", "") or "").strip()
        if not provider_account_id or not username:
            raise HTTPException(status_code=500, detail="Missing X account id or username")

        save_or_update_x_account(
            user_id=int(x_oauth_user_id),
            provider_account_id=provider_account_id,
            handle=f"@{username}",
            access_token=access_token,
            access_token_secret=access_token_secret,
            api_key=api_key,
            api_secret=api_secret,
        )

        redirect_url = f"{dashboard_redirect_url()}?provider=x&connected=1"
        html = f"""
        <html>
          <head><meta http-equiv="refresh" content="0; url={redirect_url}" /></head>
          <body style="font-family: sans-serif; background: #0b1220; color: #d7f7ff;">
            <p>X account connected. Redirecting back to dashboard…</p>
            <p><a href="{redirect_url}" style="color:#8be9ff;">Continue</a></p>
          </body>
        </html>
        """
        response = HTMLResponse(content=html)
        response.delete_cookie("x_oauth_request_secret", path="/")
        response.delete_cookie("x_oauth_request_token", path="/")
        response.delete_cookie("x_oauth_user_id", path="/")
        return response
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to complete X OAuth: {exc}")
