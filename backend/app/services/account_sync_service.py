from __future__ import annotations

import traceback
from typing import Any

import tweepy
from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.models.models import AutopilotStatus, ConnectedAccount
from app.services.bluesky_import_service import import_bluesky_posts
from app.services.x_import_service import import_x_pool_posts


def _is_connected(account: ConnectedAccount) -> bool:
    return str(getattr(account, "connection_status", "") or "").strip().lower() == "connected"


def _disconnect_account(db: Session, account: ConnectedAccount) -> None:
    account.connection_status = "disconnected"

    autopilot = (
        db.query(AutopilotStatus)
        .filter(AutopilotStatus.connected_account_id == account.id)
        .first()
    )
    if autopilot:
        autopilot.connected = False
        autopilot.enabled = False


def sync_connected_account(
    db: Session,
    *,
    account: ConnectedAccount,
    user_id: int = 1,
    bluesky_limit: int = 100,
    x_limit: int = 800,
) -> dict[str, Any]:

    handle = str(getattr(account, "handle", "") or "").strip().lstrip("@")
    provider = str(getattr(account, "provider", "") or "").strip().lower()

    if not _is_connected(account):
        return {
            "account_id": account.id,
            "provider": provider,
            "handle": handle,
            "ok": False,
            "skipped": True,
            "error": "Account is not connected",
        }

    if not handle:
        return {
            "account_id": account.id,
            "provider": provider,
            "handle": handle,
            "ok": False,
            "skipped": True,
            "error": "Missing handle",
        }

    try:

        if provider == "bluesky":
            result = import_bluesky_posts(
                db,
                user_id=user_id,
                connected_account_id=account.id,
                handle=handle,
                limit=bluesky_limit,
            )
            return {
                "account_id": account.id,
                "provider": provider,
                "handle": handle,
                "ok": True,
                **result,
            }

        if provider == "x":
            result = import_x_pool_posts(
                db,
                user_id=user_id,
                connected_account_id=account.id,
                handle=handle,
                limit=x_limit,
            )
            return {
                "account_id": account.id,
                "provider": provider,
                "handle": handle,
                "ok": True,
                **result,
            }

        return {
            "account_id": account.id,
            "provider": provider,
            "handle": handle,
            "ok": False,
            "skipped": True,
            "error": f"Unsupported provider: {provider}",
        }

    except Exception as e:

        msg = str(e)

        if provider == "x" and isinstance(e, tweepy.errors.Unauthorized):
            _disconnect_account(db, account)
            print(
                f"[evergreen][sync] X auth expired for @{handle}, "
                "marking account disconnected until reconnected"
            )
            return {
                "account_id": account.id,
                "provider": provider,
                "handle": handle,
                "ok": False,
                "skipped": True,
                "error": "X authorization expired. Reconnect X.",
            }

        # graceful bluesky rate limit handling
        if "RateLimitExceeded" in msg or "429" in msg:
            print(f"[evergreen][sync] Bluesky rate limit hit for @{handle}, skipping")
            return {
                "account_id": account.id,
                "provider": provider,
                "handle": handle,
                "ok": False,
                "skipped": True,
                "error": "Rate limit exceeded",
            }

        traceback.print_exc()

        return {
            "account_id": account.id,
            "provider": provider,
            "handle": handle,
            "ok": False,
            "skipped": False,
            "error": msg,
        }


def sync_all_connected_accounts(
    *,
    user_id: int = 1,
    bluesky_limit: int = 100,
    x_limit: int = 800,
) -> dict[str, Any]:

    db: Session = SessionLocal()

    try:

        accounts = (
            db.query(ConnectedAccount)
            .filter(ConnectedAccount.connection_status == "connected")
            .order_by(ConnectedAccount.id.asc())
            .all()
        )

        results: list[dict[str, Any]] = []

        for account in accounts:

            result = sync_connected_account(
                db,
                account=account,
                user_id=user_id,
                bluesky_limit=bluesky_limit,
                x_limit=x_limit,
            )

            results.append(result)

        db.commit()

        return {
            "ok": True,
            "accounts": results,
            "connected_account_count": len(accounts),
            "synced_count": sum(1 for r in results if r.get("ok")),
            "error_count": sum(
                1 for r in results if not r.get("ok") and not r.get("skipped")
            ),
            "skipped_count": sum(1 for r in results if r.get("skipped")),
        }

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()
