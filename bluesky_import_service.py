from __future__ import annotations

from datetime import datetime, UTC
from typing import Iterable

from app.models.models import Post


def _utc_now_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _demo_bluesky_posts(handle: str) -> list[dict]:
    safe_handle = (handle or "@creator").strip().lstrip("@")
    return [
        {
            "provider_post_id": f"at://{safe_handle}/post/evergreen-001",
            "text": "A soft launch into the timeline. Testing what resonates when the room is quiet.",
            "score": 88,
        },
        {
            "provider_post_id": f"at://{safe_handle}/post/evergreen-002",
            "text": "Little cosmic update: building a universe where posts become stars and strategy becomes gravity.",
            "score": 142,
        },
        {
            "provider_post_id": f"at://{safe_handle}/post/evergreen-003",
            "text": "A loopable thought for late night scrollers: tenderness can still be momentum.",
            "score": 126,
        },
        {
            "provider_post_id": f"at://{safe_handle}/post/evergreen-004",
            "text": "Warm signal test. Short, visual, repeatable, and meant to resurface cleanly later.",
            "score": 112,
        },
        {
            "provider_post_id": f"at://{safe_handle}/post/evergreen-005",
            "text": "Posting like a constellation map: every note means more when it connects to the next one.",
            "score": 168,
        },
        {
            "provider_post_id": f"at://{safe_handle}/post/evergreen-006",
            "text": "A more grounded check-in: good songs, better systems, slower pacing, steadier growth.",
            "score": 95,
        },
    ]


def import_bluesky_demo_posts(
    db,
    *,
    user_id: int,
    connected_account_id: int,
    handle: str,
) -> dict:
    imported = 0
    updated = 0
    now = _utc_now_naive()

    for payload in _demo_bluesky_posts(handle):
        provider_post_id = str(payload["provider_post_id"]).strip()

        existing = (
            db.query(Post)
            .filter(
                Post.connected_account_id == connected_account_id,
                Post.provider_post_id == provider_post_id,
            )
            .first()
        )

        if existing:
            existing.text = payload["text"]
            existing.score = int(payload["score"])
            existing.state = "active"
            updated += 1
            continue

        post = Post(
            user_id=user_id,
            connected_account_id=connected_account_id,
            provider_post_id=provider_post_id,
            text=payload["text"],
            score=int(payload["score"]),
            state="active",
            last_resurfaced_at=None,
            created_at=now,
        )
        db.add(post)
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
        "total_posts": total_posts,
    }
