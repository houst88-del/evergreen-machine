from __future__ import annotations

from datetime import datetime, UTC
from typing import Any

from atproto import Client

from app.models.models import ConnectedAccount, Post
from app.services.secret_crypto import decrypt_metadata


def _utc_now_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(str(value).strip() or default))
    except Exception:
        return default


def _extract_post_text(feed_item) -> str:
    try:
        record = getattr(feed_item.post, "record", None)
        text = getattr(record, "text", None)
        if text:
            return str(text)
    except Exception:
        pass
    return ""


def _extract_post_uri(feed_item) -> str:
    try:
        uri = getattr(feed_item.post, "uri", None)
        if uri:
            return str(uri)
    except Exception:
        pass
    return ""


def _extract_like_count(feed_item) -> int:
    try:
        return _safe_int(getattr(feed_item.post, "like_count", 0), 0)
    except Exception:
        return 0


def _extract_repost_count(feed_item) -> int:
    try:
        return _safe_int(getattr(feed_item.post, "repost_count", 0), 0)
    except Exception:
        return 0


def _extract_reply_count(feed_item) -> int:
    try:
        return _safe_int(getattr(feed_item.post, "reply_count", 0), 0)
    except Exception:
        return 0


def _extract_created_at(feed_item) -> datetime | None:
    try:
        raw = getattr(feed_item.post, "indexed_at", None) or getattr(feed_item.post, "created_at", None)
        if not raw:
            return None
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def _find_bluesky_account(db, connected_account_id: int) -> ConnectedAccount | None:
    return (
        db.query(ConnectedAccount)
        .filter(
            ConnectedAccount.id == connected_account_id,
            ConnectedAccount.provider == "bluesky",
        )
        .first()
    )


def import_bluesky_posts(
    db,
    *,
    user_id: int,
    connected_account_id: int,
    handle: str,
    limit: int = 100,
) -> dict:

    account = _find_bluesky_account(db, connected_account_id)
    if not account:
        return {"imported": 0, "updated": 0, "skipped": 0, "total_posts": 0}

    # ---------------------------
    # FIX: decrypt metadata first
    # ---------------------------

    metadata = decrypt_metadata(account.metadata_json or {})

    app_password = str(metadata.get("app_password", "")).strip()

    if not app_password:
        raise ValueError(
            "Bluesky app password missing. Reconnect Bluesky."
        )

    client = Client()
    client.login(handle, app_password)

    imported = 0
    updated = 0
    skipped = 0
    now = _utc_now_naive()

    response = client.app.bsky.feed.get_author_feed(
        {
            "actor": handle,
            "limit": min(limit, 100),
        }
    )

    feed = list(getattr(response, "feed", []) or [])

    for item in feed:

        provider_post_id = _extract_post_uri(item).strip()
        if not provider_post_id:
            skipped += 1
            continue

        text = _extract_post_text(item)
        score = 50 + _extract_like_count(item) * 3 + _extract_repost_count(item) * 4

        created_at = _extract_created_at(item) or now

        existing = (
            db.query(Post)
            .filter(
                Post.connected_account_id == connected_account_id,
                Post.provider_post_id == provider_post_id,
            )
            .first()
        )

        if existing:
            existing.text = text or existing.text
            existing.score = score
            updated += 1
            continue

        db.add(
            Post(
                user_id=user_id,
                connected_account_id=connected_account_id,
                provider_post_id=provider_post_id,
                text=text or provider_post_id,
                score=score,
                state="active",
                created_at=created_at,
            )
        )

        imported += 1

    db.flush()

    total_posts = (
        db.query(Post)
        .filter(Post.connected_account_id == connected_account_id)
        .count()
    )

    return {
        "imported": imported,
        "updated": updated,
        "skipped": skipped,
        "total_posts": total_posts,
    }

def import_bluesky_demo_posts(
    db,
    *,
    user_id: int,
    connected_account_id: int,
    handle: str,
):
    """
    Compatibility wrapper for older job_runner imports.
    """
    return import_bluesky_posts(
        db,
        user_id=user_id,
        connected_account_id=connected_account_id,
        handle=handle,
    )
