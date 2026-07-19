from __future__ import annotations

from datetime import UTC, datetime
from typing import Any


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(str(value).strip() or default)
    except Exception:
        return default


def evergreen_momentum_bonus(
    metrics: dict[str, Any],
    *,
    created_at: datetime | None,
    now: datetime | None = None,
) -> int:
    """Bounded bonus from the desktop app's age-aware engagement blend."""

    if not created_at:
        return 0

    reference = now or datetime.now(UTC).replace(tzinfo=None)
    if reference.tzinfo is not None:
        reference = reference.astimezone(UTC).replace(tzinfo=None)
    if created_at.tzinfo is not None:
        created_at = created_at.astimezone(UTC).replace(tzinfo=None)

    age_hours = max(6.0, (reference - created_at).total_seconds() / 3600.0)

    likes = max(0.0, _safe_float(metrics.get("like_count", 0)))
    shares = max(
        0.0,
        _safe_float(metrics.get("retweet_count", metrics.get("repost_count", 0))),
    )
    replies = max(0.0, _safe_float(metrics.get("reply_count", 0)))
    quotes = max(0.0, _safe_float(metrics.get("quote_count", 0)))

    evergreen_strength = likes + shares * 2.0 + replies * 1.5 + quotes * 2.0
    conversation_strength = replies + quotes * 2.0
    momentum = evergreen_strength / age_hours
    blended = evergreen_strength * 0.40 + momentum * 0.40 + conversation_strength * 0.20

    return max(0, min(90, int(round(blended * 0.35))))
