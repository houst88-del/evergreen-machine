from __future__ import annotations

import random
from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import Any

from sqlalchemy.orm import Session

from app.models.models import AutopilotStatus, ConnectedAccount, Post, User
from app.services.pool_service import (
    active_rotation_count,
    eligible_rows,
    mark_resurfaced,
    read_pool_rows,
)
from app.services.selector import choose_row


# Cooldown: do not intentionally resurface the same post again within this window.
COOLDOWN_DAYS = 7

# Tier thresholds
TIER_A_MIN_SCORE = 200
TIER_B_MIN_SCORE = 80
TIER_C_MIN_SCORE = 20

# Exploration: occasionally allow lower-tier content to surface on purpose.
EXPLORATION_CHANCE = 0.15


def seed_demo_data(db: Session) -> User:
    user = db.query(User).filter(User.email == "demo@evergreen.local").first()
    if user:
        autopilot = db.query(AutopilotStatus).filter(AutopilotStatus.user_id == user.id).first()
        if autopilot:
            autopilot.posts_in_rotation = active_rotation_count(user.handle)
            db.commit()
        return user

    user = User(email="demo@evergreen.local", handle="@jockulus")
    db.add(user)
    db.flush()

    autopilot = AutopilotStatus(
        user_id=user.id,
        enabled=False,
        connected=True,
        provider="x",
        posts_in_rotation=active_rotation_count(user.handle),
    )
    db.add(autopilot)
    db.commit()
    db.refresh(user)
    return user


def import_mock_posts(db: Session, user: User) -> None:
    autopilot = db.query(AutopilotStatus).filter(AutopilotStatus.user_id == user.id).first()
    if not autopilot:
        return

    autopilot.connected = True
    autopilot.posts_in_rotation = active_rotation_count(user.handle)
    autopilot.next_cycle_at = datetime.utcnow() + timedelta(minutes=10)
    db.commit()


def _utc_now_naive() -> datetime:
    return datetime.utcnow()


def _cooldown_cutoff() -> datetime:
    return _utc_now_naive() - timedelta(days=COOLDOWN_DAYS)


def _safe_score(value: Any) -> float:
    try:
        return float(value or 0)
    except Exception:
        return 0.0


def _boolish(value: Any) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "y"}


def _score_tier(score: float) -> str:
    if score >= TIER_A_MIN_SCORE:
        return "A"
    if score >= TIER_B_MIN_SCORE:
        return "B"
    if score >= TIER_C_MIN_SCORE:
        return "C"
    return "D"


def _tier_priority_order() -> list[str]:
    """
    Weighted-feeling but simple deterministic bias:
    A appears most often, but B/C/D still rotate in.
    Exploration occasionally overrides this.
    """
    return ["A", "B", "C", "A", "D", "B", "A", "C"]


def _recently_resurfaced(dt) -> bool:
    if not dt:
        return False
    return dt >= _cooldown_cutoff()


def _choose_from_tiers(items: list[dict]) -> dict | None:
    """
    items format:
    {
        "obj": ...,
        "score": float,
        "tier": "A"|"B"|"C"|"D",
        "reason": str,
    }
    """
    if not items:
        return None

    tiered: dict[str, list[dict]] = {"A": [], "B": [], "C": [], "D": []}
    for item in items:
        tiered[item["tier"]].append(item)

    for bucket in tiered.values():
        random.shuffle(bucket)

    # Exploration path: intentionally allow lower tiers sometimes.
    if random.random() < EXPLORATION_CHANCE:
        for tier in ["D", "C", "B", "A"]:
            if tiered[tier]:
                return tiered[tier][0]

    # Normal tier rotation path.
    for tier in _tier_priority_order():
        if tiered[tier]:
            return tiered[tier][0]

    return None


def _x_row_last_resurfaced(row: dict) -> datetime | None:
    raw = row.get("last_resurfaced_at")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw))
    except Exception:
        return None


def _x_row_is_original(row: dict) -> bool:
    """
    Keep X resurfacing limited to original standalone posts.

    We exclude rows that look like:
    - replies/comments
    - retweets / repost-style rows
    - obvious quote-tweet rows when the source data provides a signal
    - non-media rows when the pool tracks media availability

    This stays defensive because CSV schemas can drift a bit across environments.
    """
    if _boolish(row.get("is_reply")):
        return False

    tweet_text = str(row.get("tweet_text", "") or row.get("text", "") or "").strip()
    tweet_url = str(row.get("tweet_url", "") or "").strip()

    if tweet_text.upper().startswith("RT "):
        return False

    if _boolish(row.get("is_retweet")) or _boolish(row.get("retweeted")):
        return False

    # Some exports track quote state explicitly.
    if _boolish(row.get("is_quote_status")) or _boolish(row.get("is_quote")):
        return False

    # If media tracking exists, prefer media-first evergreen candidates.
    has_media_raw = row.get("has_media")
    if has_media_raw is not None and not _boolish(has_media_raw):
        return False

    # A few pool rows may carry reply-ish URLs or text only; keep this conservative.
    if "/status/" in tweet_url and str(row.get("in_reply_to_status_id", "") or "").strip():
        return False

    return True


def _bluesky_post_is_original(post: Post) -> bool:
    """
    Keep Bluesky resurfacing limited to original standalone posts.

    Because the DB model is lightweight, we infer reply/comment state from common
    fields that may exist on the ORM row now or later.
    """
    provider_post_id = str(getattr(post, "provider_post_id", "") or "").strip()
    if not provider_post_id.startswith("at://"):
        return False

    if getattr(post, "reply", None):
        return False

    if str(getattr(post, "in_reply_to", "") or "").strip():
        return False

    if str(getattr(post, "parent_post_id", "") or "").strip():
        return False

    if str(getattr(post, "root_post_id", "") or "").strip():
        return False

    # If a raw payload is ever attached later, use it too.
    raw = getattr(post, "raw", None)
    if isinstance(raw, dict):
        if raw.get("reply"):
            return False
        if str(raw.get("parent_post_id", "") or "").strip():
            return False
        if str(raw.get("root_post_id", "") or "").strip():
            return False
        if raw.get("embed_type") == "recordWithMediaQuote":
            return False

    return True


def _select_next_x_post(db: Session, connected_account_id: int):
    account = db.query(ConnectedAccount).filter(ConnectedAccount.id == connected_account_id).first()
    if not account:
        return None

    handle = account.handle
    rows = eligible_rows(read_pool_rows(handle))
    rows = [row for row in rows if _x_row_is_original(row)]
    if not rows:
        return None

    fresh_rows: list[dict] = []
    cooled_rows: list[dict] = []

    for row in rows:
        score = _safe_score(row.get("total_score", row.get("score", 0)))
        tier = _score_tier(score)
        item = {
            "obj": row,
            "score": score,
            "tier": tier,
            "reason": f"tier_{tier.lower()}",
        }

        if _recently_resurfaced(_x_row_last_resurfaced(row)):
            cooled_rows.append(item)
        else:
            fresh_rows.append(item)

    chosen_item = _choose_from_tiers(fresh_rows)

    # If everything is on cooldown, fall back gracefully instead of stalling.
    if not chosen_item:
        chosen_item = _choose_from_tiers(cooled_rows)

    # Final fallback to legacy selector so the engine never gets stuck.
    if not chosen_item:
        chosen, strategy, reason = choose_row(rows)
        if not chosen:
            return None
        return SimpleNamespace(
            provider_post_id=str(chosen.get("tweet_id", "")).strip(),
            text=str(chosen.get("tweet_url", "")).strip() or str(chosen.get("tweet_id", "")).strip(),
            strategy=strategy,
            reason=reason,
            raw=chosen,
        )

    chosen = chosen_item["obj"]
    score = chosen_item["score"]
    tier = chosen_item["tier"]

    return SimpleNamespace(
        provider_post_id=str(chosen.get("tweet_id", "")).strip(),
        text=str(chosen.get("tweet_url", "")).strip() or str(chosen.get("tweet_id", "")).strip(),
        strategy=f"x_tier_{tier.lower()}",
        reason=f"tier_rotation score={int(score)} cooldown={COOLDOWN_DAYS}d",
        raw=chosen,
    )


def _select_next_bluesky_post(db: Session, connected_account_id: int):
    posts = (
        db.query(Post)
        .filter(
            Post.connected_account_id == connected_account_id,
            Post.state == "active",
        )
        .order_by(Post.score.desc(), Post.id.asc())
        .all()
    )

    valid_posts = [post for post in posts if _bluesky_post_is_original(post)]

    if not valid_posts:
        return None

    fresh_posts: list[dict] = []
    cooled_posts: list[dict] = []

    for post in valid_posts:
        score = _safe_score(getattr(post, "score", 0))
        tier = _score_tier(score)
        item = {
            "obj": post,
            "score": score,
            "tier": tier,
            "reason": f"tier_{tier.lower()}",
        }

        if _recently_resurfaced(getattr(post, "last_resurfaced_at", None)):
            cooled_posts.append(item)
        else:
            fresh_posts.append(item)

    chosen_item = _choose_from_tiers(fresh_posts)

    if not chosen_item:
        chosen_item = _choose_from_tiers(cooled_posts)

    if not chosen_item:
        return None

    post = chosen_item["obj"]
    score = chosen_item["score"]
    tier = chosen_item["tier"]

    return SimpleNamespace(
        provider_post_id=str(post.provider_post_id).strip(),
        text=str(post.text or post.provider_post_id).strip(),
        strategy=f"bluesky_tier_{tier.lower()}",
        reason=f"tier_rotation score={int(score)} cooldown={COOLDOWN_DAYS}d",
        raw={"source": "bluesky_db", "post_id": getattr(post, "id", None)},
    )


def select_next_post(db: Session, connected_account_id: int):
    account = db.query(ConnectedAccount).filter(ConnectedAccount.id == connected_account_id).first()
    if not account:
        return None

    provider = str(account.provider or "").strip().lower()

    if provider == "bluesky":
        return _select_next_bluesky_post(db, connected_account_id)

    return _select_next_x_post(db, connected_account_id)


def record_resurfaced_post(db: Session, connected_account_id: int, post) -> None:
    now = datetime.utcnow()

    account = db.query(ConnectedAccount).filter(ConnectedAccount.id == connected_account_id).first()
    if not account:
        return

    provider = str(account.provider or "").strip().lower()
    handle = account.handle

    autopilot = (
        db.query(AutopilotStatus)
        .filter(AutopilotStatus.connected_account_id == connected_account_id)
        .first()
    )

    if provider == "x":
        updated_row = mark_resurfaced(post.provider_post_id, handle)
        if autopilot:
            autopilot.last_post_text = (
                str(updated_row.get("tweet_url", "")).strip()
                if updated_row
                else post.text
            )
            autopilot.last_action_at = now
            autopilot.posts_in_rotation = active_rotation_count(handle)
            # job_runner owns the real refresh schedule now; do not overwrite it here.
        db.commit()
        return

    if provider == "bluesky":
        db_post = (
            db.query(Post)
            .filter(
                Post.connected_account_id == connected_account_id,
                Post.provider_post_id == str(getattr(post, "provider_post_id", "")).strip(),
            )
            .first()
        )
        if db_post:
            db_post.last_resurfaced_at = now

        if autopilot:
            autopilot.last_post_text = str(
                getattr(post, "text", "") or getattr(post, "provider_post_id", "")
            ).strip()
            autopilot.last_action_at = now
            autopilot.posts_in_rotation = (
                db.query(Post)
                .filter(
                    Post.connected_account_id == connected_account_id,
                    Post.state == "active",
                )
                .count()
            )
            # job_runner owns the real refresh schedule now; do not overwrite it here.

        db.commit()
        return

    db.commit()
