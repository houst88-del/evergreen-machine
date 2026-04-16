from __future__ import annotations

import os
from datetime import datetime
from typing import Any

import tweepy
from sqlalchemy.orm import Session

from app.models.models import Post, ConnectedAccount


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(str(value).strip() or default))
    except Exception:
        return default


def _normalize_handle(handle: str | None) -> str:
    raw = str(handle or "").strip()
    return raw.lstrip("@") if raw else ""


def _make_client(db: Session, connected_account_id: int) -> tuple[tweepy.Client, str]:
    """
    Build Tweepy client from DB + environment variables
    instead of config.json
    """

    account = db.query(ConnectedAccount).filter(
        ConnectedAccount.id == connected_account_id
    ).first()

    if not account:
        raise RuntimeError(f"ConnectedAccount {connected_account_id} not found")

    access_token = getattr(account, "access_token", None)
    access_token_secret = getattr(account, "access_token_secret", None)
    user_id = str(getattr(account, "provider_user_id", "") or "").strip()

    if not access_token or not access_token_secret:
        raise RuntimeError("Missing OAuth tokens for X account")

    api_key = os.getenv("X_API_KEY")
    api_secret = os.getenv("X_API_SECRET")

    if not api_key or not api_secret:
        raise RuntimeError("Missing X_API_KEY or X_API_SECRET env vars")

    client = tweepy.Client(
        consumer_key=api_key,
        consumer_secret=api_secret,
        access_token=access_token,
        access_token_secret=access_token_secret,
        wait_on_rate_limit=True,
    )

    return client, user_id


def _parse_datetime(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None

    candidates = [raw, raw.replace("Z", "+00:00")]
    for candidate in candidates:
        try:
            dt = datetime.fromisoformat(candidate)
            if dt.tzinfo is not None:
                return dt.replace(tzinfo=None)
            return dt
        except Exception:
            continue
    return None


def _tweet_text(tweet: Any) -> str:
    text = getattr(tweet, "text", None)
    return str(text).strip() if text else ""


def _tweet_id(tweet: Any) -> str:
    tweet_id = getattr(tweet, "id", None)
    return str(tweet_id).strip() if tweet_id is not None else ""


def _tweet_created_at(tweet: Any) -> datetime | None:
    created_at = getattr(tweet, "created_at", None)
    if hasattr(created_at, "isoformat"):
        return _parse_datetime(created_at.isoformat())
    return _parse_datetime(created_at)


def _tweet_metrics(tweet: Any) -> dict[str, int]:
    metrics = getattr(tweet, "public_metrics", None) or {}
    if not isinstance(metrics, dict):
        metrics = {}

    return {
        "like_count": _safe_int(metrics.get("like_count", 0)),
        "retweet_count": _safe_int(metrics.get("retweet_count", 0)),
        "reply_count": _safe_int(metrics.get("reply_count", 0)),
        "quote_count": _safe_int(metrics.get("quote_count", 0)),
        "bookmark_count": _safe_int(metrics.get("bookmark_count", 0)),
        "impression_count": _safe_int(metrics.get("impression_count", 0)),
    }


def _score_from_metrics(metrics: dict[str, int]) -> int:
    score = (
        50
        + metrics["like_count"] * 3
        + metrics["retweet_count"] * 4
        + metrics["reply_count"] * 2
        + metrics["quote_count"] * 3
        + min(100, int(metrics["impression_count"] / 250))
    )
    return max(10, int(score))


def _tweet_url(handle: str, tweet_id: str) -> str:
    clean = _normalize_handle(handle)
    return f"https://x.com/{clean}/status/{tweet_id}"


def import_x_pool_posts(
    db: Session,
    *,
    user_id: int,
    connected_account_id: int,
    handle: str,
    limit: int = 200,
) -> dict[str, int]:

    client, x_user_id = _make_client(db, connected_account_id)

    if not x_user_id:
        raise RuntimeError("Missing provider_user_id for connected account")

    existing_posts = (
        db.query(Post)
        .filter(Post.connected_account_id == connected_account_id)
        .all()
    )

    existing_map = {
        str(p.provider_post_id): p for p in existing_posts if p.provider_post_id
    }

    imported = 0
    updated = 0
    skipped = 0

    response = client.get_users_tweets(
        id=x_user_id,
        max_results=min(limit, 100),
        tweet_fields=["created_at", "public_metrics"],
        exclude=["retweets"],
        user_auth=True,
    )

    tweets = list(getattr(response, "data", None) or [])

    for tweet in tweets:

        tweet_id = _tweet_id(tweet)
        if not tweet_id:
            skipped += 1
            continue

        metrics = _tweet_metrics(tweet)
        text = _tweet_text(tweet)
        score = _score_from_metrics(metrics)
        created_at = _tweet_created_at(tweet)

        existing = existing_map.get(tweet_id)

        if existing:
            existing.text = text or existing.text
            existing.score = score
            updated += 1
            continue

        db.add(
            Post(
                user_id=user_id,
                connected_account_id=connected_account_id,
                provider_post_id=tweet_id,
                text=text or _tweet_url(handle, tweet_id),
                score=score,
                state="active",
                created_at=created_at,
            )
        )

        imported += 1

    db.flush()

    return {
        "imported": imported,
        "updated": updated,
        "skipped": skipped,
    }


def import_x_posts(
    db: Session,
    *,
    user_id: int,
    connected_account_id: int,
    handle: str,
    limit: int = 200,
):
    return import_x_pool_posts(
        db,
        user_id=user_id,
        connected_account_id=connected_account_id,
        handle=handle,
        limit=limit,
    )
