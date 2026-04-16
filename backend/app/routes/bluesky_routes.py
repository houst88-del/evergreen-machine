
from fastapi import APIRouter, HTTPException, Query
from atproto import Client
from atproto_client.exceptions import RequestException

from app.core.db import SessionLocal
from app.models.models import ConnectedAccount
from app.services.secret_crypto import encrypt_metadata

router = APIRouter(prefix="/api/providers/bluesky", tags=["bluesky"])


@router.post("/connect")
def connect_bluesky(payload: dict, user_id: int = Query(1, ge=1)):
    """
    Connect a Bluesky account using handle + app password.

    Improvements in this version:
    - Gracefully handles rate limits
    - Gracefully handles bad credentials
    - Prevents raw 500 errors reaching the frontend
    - Stores credentials encrypted
    """

    handle = str(payload.get("handle", "")).strip()
    password = str(payload.get("app_password", "")).strip()

    if not handle or not password:
        raise HTTPException(
            status_code=400,
            detail="Bluesky handle and app_password are required",
        )

    client = Client()

    try:
        profile = client.login(handle, password)

    except RequestException as exc:
        msg = str(exc)

        # Rate limit
        if "RateLimitExceeded" in msg:
            raise HTTPException(
                status_code=429,
                detail="Bluesky rate limit reached. Please wait a few minutes and try again.",
            )

        # Invalid login
        if "AuthenticationRequired" in msg or "Invalid identifier or password" in msg:
            raise HTTPException(
                status_code=401,
                detail="Invalid Bluesky handle or app password.",
            )

        # Unknown ATProto error
        raise HTTPException(
            status_code=500,
            detail=f"Bluesky login failed: {msg}",
        )

    provider_account_id = str(getattr(profile, "did", "") or "").strip()

    if not provider_account_id:
        provider_account_id = f"local-bluesky-{user_id}"

    db = SessionLocal()

    try:
        account = (
            db.query(ConnectedAccount)
            .filter(
                ConnectedAccount.user_id == user_id,
                ConnectedAccount.provider == "bluesky",
            )
            .first()
        )

        secure_metadata = encrypt_metadata({
            "source": "bluesky_atproto",
            "pacing_mode": "standard",
            "app_password": password,
        })

        if not account:
            account = ConnectedAccount(
                user_id=user_id,
                provider="bluesky",
                provider_account_id=provider_account_id,
                handle=handle,
                access_token="bluesky",
                refresh_token="bluesky",
                token_expires_at=None,
                connection_status="connected",
                metadata_json=secure_metadata,
            )
            db.add(account)

        else:
            account.provider_account_id = provider_account_id
            account.handle = handle
            account.access_token = "bluesky"
            account.refresh_token = "bluesky"
            account.token_expires_at = None
            account.connection_status = "connected"
            account.metadata_json = secure_metadata

        db.commit()

        return {
            "ok": True,
            "provider": "bluesky",
            "handle": handle,
            "provider_account_id": provider_account_id,
        }

    finally:
        db.close()
