from __future__ import annotations

import csv
import json
from datetime import datetime
from pathlib import Path
from typing import Any


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(str(value).strip() or default)
    except Exception:
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(str(value).strip() or default))
    except Exception:
        return default


def _boolish(value: Any) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


def normalize_handle(handle: str | None) -> str:
    raw = str(handle or "").strip()
    if not raw:
        return "jockulus"
    return raw.lstrip("@").strip()


def base_client_dir() -> Path:
    return Path.home() / "Applications" / "evergreen-system" / "clients"


def resolve_client_dir(handle: str | None = None) -> Path:
    return base_client_dir() / normalize_handle(handle)


def pool_file(handle: str | None = None) -> Path:
    return resolve_client_dir(handle) / "tweet_refresh_pool.csv"


def results_file(handle: str | None = None) -> Path:
    return resolve_client_dir(handle) / "tweet_results.csv"


def analytics_file(handle: str | None = None) -> Path:
    return resolve_client_dir(handle) / "tweet_analytics.csv"


def dead_tweet_cache_file(handle: str | None = None) -> Path:
    return resolve_client_dir(handle) / "dead_tweets.json"


def _ensure_default_columns(row: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(row)
    normalized.setdefault("retired", "no")
    normalized.setdefault("retired_reason", "")
    normalized.setdefault("dead_tweet_at", "")
    return normalized


def read_pool_rows(handle: str | None = None) -> list[dict[str, Any]]:
    path = pool_file(handle)
    if not path.exists():
        return []

    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    return [_ensure_default_columns(row) for row in rows]


def write_pool_rows(rows: list[dict[str, Any]], handle: str | None = None) -> None:
    path = pool_file(handle)
    if not rows:
        return

    path.parent.mkdir(parents=True, exist_ok=True)
    normalized_rows = [_ensure_default_columns(row) for row in rows]

    fieldnames: list[str] = []
    for row in normalized_rows:
        for key in row.keys():
            if key not in fieldnames:
                fieldnames.append(key)

    preferred_prefix = [
        "tweet_id",
        "tweet_url",
        "score",
        "underperform",
        "is_reply",
        "has_media",
        "media_type",
        "tweet_age_hours",
        "retired",
        "retired_reason",
        "dead_tweet_at",
        "refresh_count",
        "cycle_retweeted",
        "last_retweeted_at",
    ]
    ordered_fieldnames = [k for k in preferred_prefix if k in fieldnames] + [k for k in fieldnames if k not in preferred_prefix]

    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=ordered_fieldnames)
        writer.writeheader()
        writer.writerows(normalized_rows)


def read_dead_tweet_cache(handle: str | None = None) -> dict[str, Any]:
    path = dead_tweet_cache_file(handle)
    if not path.exists():
        return {}

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def write_dead_tweet_cache(cache: dict[str, Any], handle: str | None = None) -> None:
    path = dead_tweet_cache_file(handle)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cache, indent=2, sort_keys=True), encoding="utf-8")


def remember_dead_tweet(tweet_id: str, handle: str | None = None, reason: str = "dead_tweet") -> None:
    tweet_id = str(tweet_id).strip()
    if not tweet_id:
        return

    cache = read_dead_tweet_cache(handle)
    cache[tweet_id] = {
        "reason": reason,
        "recorded_at": datetime.utcnow().isoformat(timespec="seconds"),
    }
    write_dead_tweet_cache(cache, handle)


def is_known_dead_tweet(tweet_id: str, handle: str | None = None) -> bool:
    tweet_id = str(tweet_id).strip()
    if not tweet_id:
        return False
    cache = read_dead_tweet_cache(handle)
    return tweet_id in cache


def eligible_rows(rows: list[dict[str, Any]], handle: str | None = None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    for row in rows:
        row = _ensure_default_columns(row)

        if _boolish(row.get("retired", "no")):
            continue
        if str(row.get("retired_reason", "")).strip().lower() == "dead_tweet":
            continue
        if is_known_dead_tweet(row.get("tweet_id", ""), handle):
            continue
        if _boolish(row.get("is_reply", "no")):
            continue

        score = _safe_float(row.get("score", 0))
        age_hours = _safe_float(row.get("tweet_age_hours", 0))
        refresh_count = _safe_int(row.get("refresh_count", 0))

        if score < 10 and refresh_count >= 2:
            continue
        if age_hours < 12:
            continue

        out.append(row)

    return out


def retire_dead_tweet(tweet_id: str, handle: str | None = None, reason: str = "dead_tweet") -> bool:
    tweet_id = str(tweet_id).strip()
    if not tweet_id:
        return False

    rows = read_pool_rows(handle)
    changed = False
    timestamp = datetime.utcnow().isoformat(timespec="seconds")

    for row in rows:
        if str(row.get("tweet_id", "")).strip() != tweet_id:
            continue

        row["retired"] = "yes"
        row["retired_reason"] = reason
        row["dead_tweet_at"] = timestamp
        changed = True

    if changed:
        write_pool_rows(rows, handle)

    remember_dead_tweet(tweet_id, handle=handle, reason=reason)
    return changed


def mark_resurfaced(tweet_id: str, handle: str | None = None) -> dict[str, Any] | None:
    rows = read_pool_rows(handle)
    if not rows:
        return None

    updated_row: dict[str, Any] | None = None
    for row in rows:
        if str(row.get("tweet_id", "")).strip() != str(tweet_id).strip():
            continue

        refresh_count = _safe_int(row.get("refresh_count", 0)) + 1
        row["refresh_count"] = str(refresh_count)
        row["cycle_retweeted"] = "yes"
        row["last_retweeted_at"] = datetime.utcnow().isoformat(timespec="seconds")
        updated_row = row
        break

    if updated_row:
        write_pool_rows(rows, handle)

    return updated_row


def active_rotation_count(handle: str | None = None) -> int:
    return len(eligible_rows(read_pool_rows(handle), handle=handle))
