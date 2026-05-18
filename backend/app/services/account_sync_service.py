from __future__ import annotations

import os
import traceback
from datetime import UTC, datetime, timedelta
from typing import Any

import tweepy
from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.models.models import AutopilotStatus, ConnectedAccount
from app.services.bluesky_import_service import import_bluesky_posts
from app.services.x_import_service import import_x_pool_posts


DEFAULT_X_SYNC_LIMIT = 50
DEFAULT_X_SYNC_INTERVAL_MINUTES = 360


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, *, minimum: int = 0) -> int:
    try:
        value = int(str(os.getenv(name, default)).strip())
    except Exception:
        value = default
    return max(minimum, value)


def _utc_now_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _parse_iso_naive(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is not None:
            return parsed.astimezone(UTC).replace(tzinfo=None)
        return parsed
    except Exception:
        return None


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
    x_limit: int = DEFAULT_X_SYNC_LIMIT,
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
            if not _env_bool("EVERGREEN_X_SYNC_ENABLED", True):
                return {
                    "account_id": account.id,
                    "provider": provider,
                    "handle": handle,
                    "ok": False,
                    "skipped": True,
                    "error": "X sync disabled by EVERGREEN_X_SYNC_ENABLED",
                }

            metadata = dict(getattr(account, "metadata_json", None) or {})
            interval_minutes = _env_int(
                "EVERGREEN_X_SYNC_INTERVAL_MINUTES",
                DEFAULT_X_SYNC_INTERVAL_MINUTES,
                minimum=1,
            )
            last_sync_at = _parse_iso_naive(metadata.get("last_x_sync_at"))
            if last_sync_at and last_sync_at > _utc_now_naive() - timedelta(minutes=interval_minutes):
                next_sync_at = last_sync_at + timedelta(minutes=interval_minutes)
                return {
                    "account_id": account.id,
                    "provider": provider,
                    "handle": handle,
                    "ok": False,
                    "skipped": True,
                    "error": f"X sync throttled until {next_sync_at.isoformat()}",
                    "next_sync_at": next_sync_at.isoformat(),
                }

            effective_x_limit = min(
                max(0, int(x_limit or 0)),
                _env_int("EVERGREEN_X_SYNC_LIMIT", DEFAULT_X_SYNC_LIMIT, minimum=0),
            )
            if effective_x_limit <= 0:
                return {
                    "account_id": account.id,
                    "provider": provider,
                    "handle": handle,
                    "ok": False,
                    "skipped": True,
                    "error": "X sync limit is 0",
                }

            result = import_x_pool_posts(
                db,
                user_id=user_id,
                connected_account_id=account.id,
                handle=handle,
                limit=effective_x_limit,
            )
            metadata.update(
                {
                    "last_x_sync_at": _utc_now_naive().isoformat(),
                    "last_x_sync_limit": effective_x_limit,
                    "last_x_sync_fetched": int(result.get("fetched", 0) or 0),
                    "last_x_sync_imported": int(result.get("imported", 0) or 0),
                    "last_x_sync_updated": int(result.get("updated", 0) or 0),
                }
            )
            account.metadata_json = metadata
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
    x_limit: int = DEFAULT_X_SYNC_LIMIT,
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
