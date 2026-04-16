from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

import tweepy
from sqlalchemy.orm import Session

from app.models.models import Post


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(str(value).strip() or default))
    except Exception:
        return default


def _normalize_handle(handle: str | None) -> str:
    raw = str(handle or "").strip()
    return raw.lstrip("@") if raw else "jockulus"


def _resolve_client_dir(handle: str | None = None) -> Path:
    return Path.home() / "Applications" / "evergreen-system" / "clients" / _normalize_handle(handle)


def _config_file(handle: str | None = None) -> Path:
    return _resolve_client_dir(handle) / "config.json"


def _load_config(handle: str | None = None) -> tuple[dict[str, Any], Path]:
    path = _config_file(handle)
    if not path.exists():
        raise FileNotFoundError(f"Missing config.json at: {path}")

    with open(path, "r", encoding="utf-8") as f:
        config = json.load(f)

    required = [
        "api_key",
        "api_secret",
        "access_token",
        "access_token_secret",
        "user_id",
    ]
    missing = [k for k in required if not str(config.get(k, "")).strip()]
    if missing:
        raise ValueError(f"Missing config.json fields in {path.name}: {', '.join(missing)}")

    return config, path


def _make_client(handle: str | None = None) -> tuple[tweepy.Client, dict[str, Any], Path]:
    config, path = _load_config(handle)

    client = tweepy.Client(
        consumer_key=config["api_key"],
        consumer_secret=config["api_secret"],
        access_token=config["access_token"],
        access_token_secret=config["access_token_secret"],
        wait_on_rate_limit=True,
    )
    return client, config, path


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
    if text:
        return str(text).strip()
    return ""


def _tweet_id(tweet: Any) -> str:
    tweet_id = getattr(tweet, "id", None)
    return str(tweet_id).strip() if tweet_id is not None else ""


def _tweet_created_at(tweet: Any) -> datetime | None:
    created_at = getattr(tweet, "created_at", None)
    return _parse_datetime(created_at.isoformat() if hasattr(created_at, "isoformat") else created_at)


def _tweet_metrics(tweet: Any) -> dict[str, int]:
    metrics = getattr(tweet, "public_metrics", None) or {}
    if not isinstance(metrics, dict):
        metrics = {}
    return {
        "like_count": _safe_int(metrics.get("like_count", 0), 0),
        "retweet_count": _safe_int(metrics.get("retweet_count", 0), 0),
        "reply_count": _safe_int(metrics.get("reply_count", 0), 0),
        "quote_count": _safe_int(metrics.get("quote_count", 0), 0),
        "bookmark_count": _safe_int(metrics.get("bookmark_count", 0), 0),
        "impression_count": _safe_int(metrics.get("impression_count", 0), 0),
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
    clean_handle = _normalize_handle(handle)
    return f"https://x.com/{clean_handle}/status/{tweet_id}"


def _normalize_state(metrics: dict[str, int]) -> str:
    _ = metrics
    return "active"


def import_x_pool_posts(
    db: Session,
    *,
    user_id: int,
    connected_account_id: int,
    handle: str,
    limit: int = 200,
) -> dict[str, int]:
    """
    X importer for the app/web backend.

    Important compatibility note:
    The current Post ORM model in this codebase does NOT accept a ``raw=...`` kwarg.
    This version avoids writing ``raw`` entirely so analytics jobs stop failing with:

        'raw' is an invalid keyword argument for Post
    """
    client, config, _cfg_path = _make_client(handle)
    x_user_id = str(config.get("user_id", "")).strip()
    if not x_user_id:
        raise ValueError(f"Missing user_id in X config for @{_normalize_handle(handle)}")

    existing_posts = (
        db.query(Post)
        .filter(Post.connected_account_id == connected_account_id)
        .all()
    )
    existing_by_provider_post_id = {
        str(post.provider_post_id).strip(): post
        for post in existing_posts
        if str(post.provider_post_id).strip()
    }

    imported = 0
    updated = 0
    skipped = 0

    next_token: str | None = None
    fetched = 0

    while fetched < limit:
        page_size = min(100, limit - fetched)
        response = client.get_users_tweets(
            id=x_user_id,
            max_results=page_size,
            tweet_fields=["created_at", "public_metrics"],
            exclude=["retweets"],
            pagination_token=next_token,
            user_auth=True,
        )

        tweets = list(getattr(response, "data", None) or [])
        if not tweets:
            break

        for tweet in tweets:
            tweet_id = _tweet_id(tweet)
            if not tweet_id:
                skipped += 1
                continue

            metrics = _tweet_metrics(tweet)
            text = _tweet_text(tweet)
            score = _score_from_metrics(metrics)
            state = _normalize_state(metrics)
            created_at = _tweet_created_at(tweet)
            tweet_url = _tweet_url(handle, tweet_id)

            existing = existing_by_provider_post_id.get(tweet_id)
            if existing:
                existing.text = text or tweet_url or existing.text
                existing.score = score
                existing.state = state
                if created_at and not getattr(existing, "created_at", None):
                    existing.created_at = created_at
                updated += 1
                continue

            db.add(
                Post(
                    user_id=user_id,
                    connected_account_id=connected_account_id,
                    provider_post_id=tweet_id,
                    text=text or tweet_url,
                    score=score,
                    state=state,
                    last_resurfaced_at=None,
                    created_at=created_at,
                )
            )
            imported += 1

        fetched += len(tweets)
        meta = getattr(response, "meta", None) or {}
        if isinstance(meta, dict):
            next_token = meta.get("next_token")
        else:
            next_token = getattr(meta, "next_token", None)

        if not next_token:
            break

    db.flush()

    active_total = (
        db.query(Post)
        .filter(
            Post.connected_account_id == connected_account_id,
            Post.state == "active",
        )
        .count()
    )

    total_posts = (
        db.query(Post)
        .filter(Post.connected_account_id == connected_account_id)
        .count()
    )

    return {
        "imported": imported,
        "updated": updated,
        "skipped": skipped,
        "active_posts": active_total,
        "total_posts": total_posts,
    }


def import_x_posts(
    db: Session,
    *,
    user_id: int,
    connected_account_id: int,
    handle: str,
    limit: int = 200,
) -> dict[str, int]:
    return import_x_pool_posts(
        db,
        user_id=user_id,
        connected_account_id=connected_account_id,
        handle=handle,
        limit=limit,
    )
