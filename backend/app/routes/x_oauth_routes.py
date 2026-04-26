from __future__ import annotations

import os
from datetime import UTC, datetime

import tweepy
from fastapi import APIRouter, Cookie, HTTPException, Query, Request
from fastapi.responses import RedirectResponse

from app.core.security import verify_token
from app.core.db import SessionLocal
from app.core.subscription_state import ensure_user_subscription_state
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
    app_base = (
        os.getenv("EVERGREEN_APP_URL", "").strip()
        or os.getenv("EVERGREEN_DASHBOARD_URL", "").strip()
        or "https://www.evergreenmachine.ai"
    ).rstrip("/")

    # Preview deployment hosts can trigger Vercel auth instead of returning
    # the user to the live product after OAuth completes.
    if "vercel.app" in app_base or "vercel.com" in app_base:
        app_base = "https://www.evergreenmachine.ai"

    if app_base.endswith("/dashboard"):
        return app_base

    return f"{app_base}/dashboard"


def get_or_create_account_scoped_autopilot(
    db,
    user: User,
    account: ConnectedAccount,
) -> AutopilotStatus:
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


def maybe_enable_connected_lane(db, user: User, autopilot: AutopilotStatus) -> AutopilotStatus:
    subscription = ensure_user_subscription_state(db, user, stripe_reconcile=True)
    if not subscription.get("can_run_autopilot"):
        return autopilot

    if not autopilot.connected:
        return autopilot

    autopilot.enabled = True
    autopilot.last_action_at = datetime.now(UTC).replace(tzinfo=None)
    autopilot.next_cycle_at = datetime.now(UTC).replace(tzinfo=None)
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
        autopilot = maybe_enable_connected_lane(db, user, autopilot)

        db.commit()
        db.refresh(account)
        db.refresh(autopilot)

        return int(account.id)
    finally:
        db.close()


@router.get("/start")
def start_oauth(user_id: int = Query(..., ge=1), auth_token: str | None = Query(default=None)):
    api_key, api_secret, callback = oauth_config()

    resolved_user_id = user_id
    if auth_token:
        payload = verify_token(str(auth_token).strip())
        token_user_id = payload.get("user_id") if payload else None
        if not token_user_id:
            raise HTTPException(status_code=401, detail="Invalid or expired auth token")
        resolved_user_id = int(token_user_id)

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
            value=str(resolved_user_id),
            httponly=True,
            secure=True,
            samesite="lax",
            max_age=600,
            path="/",
        )
        return response
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to start X OAuth: {exc}")


@router.get("/callback")
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

        connected_account_id = save_or_update_x_account(
            user_id=int(x_oauth_user_id),
            provider_account_id=provider_account_id,
            handle=f"@{username}",
            access_token=access_token,
            access_token_secret=access_token_secret,
            api_key=api_key,
            api_secret=api_secret,
        )

        redirect_url = (
            f"{dashboard_redirect_url()}?provider=x&connected=1"
            f"&connected_account_id={connected_account_id}"
        )
        response = RedirectResponse(url=redirect_url, status_code=303)
        response.delete_cookie("x_oauth_request_secret", path="/")
        response.delete_cookie("x_oauth_request_token", path="/")
        response.delete_cookie("x_oauth_user_id", path="/")
        return response
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to complete X OAuth: {exc}")
