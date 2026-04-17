from __future__ import annotations

import os
from datetime import datetime
from typing import Any

import tweepy
from sqlalchemy.orm import Session

from app.models.models import ConnectedAccount, Post
from app.services.secret_crypto import decrypt_secret


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(str(value).strip() or default))
    except Exception:
        return default


def _normalize_handle(handle: str | None) -> str:
    raw = str(handle or "").strip()
    return raw.lstrip("@") if raw else ""


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


def _parse_v1_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    return _parse_datetime(value)


def _make_clients(
    db: Session,
    connected_account_id: int,
) -> tuple[tweepy.Client, tweepy.API, str]:
    account = (
        db.query(ConnectedAccount)
        .filter(ConnectedAccount.id == connected_account_id)
        .first()
    )

    if not account:
        raise RuntimeError(f"Connected account not found: {connected_account_id}")

    raw_access_token = getattr(account, "access_token", None)
    raw_access_token_secret = getattr(account, "access_token_secret", None)

    access_token = decrypt_secret(raw_access_token) if raw_access_token else None
    access_token_secret = (
        decrypt_secret(raw_access_token_secret) if raw_access_token_secret else None
    )

    provider_account_id = str(
        getattr(account, "provider_account_id", None)
        or getattr(account, "provider_user_id", None)
        or ""
    ).strip()

    if not access_token:
        raise RuntimeError("Missing OAuth access_token for X account")

    if not access_token_secret:
        raise RuntimeError("Missing OAuth access_token_secret for X account")

    if not provider_account_id:
        raise RuntimeError("Missing provider_account_id for connected account")

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

    auth = tweepy.OAuth1UserHandler(
        api_key,
        api_secret,
        access_token,
        access_token_secret,
    )
    api_v1 = tweepy.API(auth, wait_on_rate_limit=True)

    return client, api_v1, provider_account_id


def _upsert_post(
    db: Session,
    *,
    existing_map: dict[str, Post],
    user_id: int,
    connected_account_id: int,
    handle: str,
    tweet_id: str,
    text: str,
    score: int,
    created_at: datetime | None,
) -> str:
    existing = existing_map.get(tweet_id)
    if existing:
        existing.text = text or existing.text
        existing.score = score
        if created_at and not getattr(existing, "created_at", None):
            existing.created_at = created_at
        return "updated"

    post = Post(
        user_id=user_id,
        connected_account_id=connected_account_id,
        provider_post_id=tweet_id,
        text=text or _tweet_url(handle, tweet_id),
        score=score,
        state="active",
        last_resurfaced_at=None,
        created_at=created_at,
    )
    db.add(post)
    existing_map[tweet_id] = post
    return "imported"


def _backfill_from_v1_timeline(
    *,
    api_v1: tweepy.API,
    x_user_id: str,
    handle: str,
    limit: int,
    db: Session,
    existing_map: dict[str, Post],
    user_id: int,
    connected_account_id: int,
) -> dict[str, int]:
    imported = 0
    updated = 0
    skipped = 0
    fetched = 0
    max_id: int | None = None

    while fetched < limit:
        page_size = min(200, limit - fetched)
        timeline = api_v1.user_timeline(
            user_id=x_user_id,
            count=page_size,
            max_id=max_id,
            include_rts=False,
            exclude_replies=False,
            tweet_mode="extended",
        )
        tweets = list(timeline or [])
        if not tweets:
            break

        if max_id is not None and tweets and int(getattr(tweets[0], "id", 0) or 0) == max_id:
            tweets = tweets[1:]
            if not tweets:
                break

        for tweet in tweets:
            tweet_id = str(getattr(tweet, "id_str", "") or getattr(tweet, "id", "")).strip()
            if not tweet_id:
                skipped += 1
                continue

            text = str(
                getattr(tweet, "full_text", None)
                or getattr(tweet, "text", None)
                or ""
            ).strip()
            favorite_count = _safe_int(getattr(tweet, "favorite_count", 0), 0)
            retweet_count = _safe_int(getattr(tweet, "retweet_count", 0), 0)
            reply_count = _safe_int(getattr(tweet, "reply_count", 0), 0)
            quote_count = _safe_int(getattr(tweet, "quote_count", 0), 0)
            score = max(
                10,
                int(50 + favorite_count * 3 + retweet_count * 4 + reply_count * 2 + quote_count * 3),
            )
            created_at = _parse_v1_datetime(getattr(tweet, "created_at", None))

            result = _upsert_post(
                db,
                existing_map=existing_map,
                user_id=user_id,
                connected_account_id=connected_account_id,
                handle=handle,
                tweet_id=tweet_id,
                text=text,
                score=score,
                created_at=created_at,
            )
            if result == "imported":
                imported += 1
            else:
                updated += 1

        fetched += len(tweets)
        last_tweet_id = int(getattr(tweets[-1], "id", 0) or 0)
        if not last_tweet_id:
            break
        max_id = last_tweet_id - 1

    return {
        "imported": imported,
        "updated": updated,
        "skipped": skipped,
        "fetched": fetched,
    }


def import_x_pool_posts(
    db: Session,
    *,
    user_id: int,
    connected_account_id: int,
    handle: str,
    limit: int = 800,
) -> dict[str, int]:
    client, api_v1, x_user_id = _make_clients(db, connected_account_id)

    existing_posts = (
        db.query(Post)
        .filter(Post.connected_account_id == connected_account_id)
        .all()
    )

    existing_map = {
        str(post.provider_post_id).strip(): post
        for post in existing_posts
        if str(post.provider_post_id).strip()
    }

    imported = 0
    updated = 0
    skipped = 0
    fetched = 0
    next_token: str | None = None

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
            created_at = _tweet_created_at(tweet)

            result = _upsert_post(
                db,
                existing_map=existing_map,
                user_id=user_id,
                connected_account_id=connected_account_id,
                handle=handle,
                tweet_id=tweet_id,
                text=text,
                score=score,
                created_at=created_at,
            )
            if result == "imported":
                imported += 1
            else:
                updated += 1

        fetched += len(tweets)

        meta = getattr(response, "meta", None) or {}
        if isinstance(meta, dict):
            next_token = meta.get("next_token")
        else:
            next_token = getattr(meta, "next_token", None)

        if not next_token:
            break

    # Some X app/user combinations return only a very shallow v2 timeline.
    # When that happens, backfill through the OAuth1 timeline instead of
    # accepting an obviously incomplete pool.
    if fetched < min(limit, 25):
        fallback = _backfill_from_v1_timeline(
            api_v1=api_v1,
            x_user_id=x_user_id,
            handle=handle,
            limit=limit,
            db=db,
            existing_map=existing_map,
            user_id=user_id,
            connected_account_id=connected_account_id,
        )
        imported += fallback["imported"]
        updated += fallback["updated"]
        skipped += fallback["skipped"]
        fetched = max(fetched, fallback["fetched"])

    db.flush()

    active_posts = (
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
        "active_posts": active_posts,
        "total_posts": total_posts,
        "fetched": fetched,
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
