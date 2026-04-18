from __future__ import annotations

import math
import random
from collections import Counter
from datetime import datetime, timedelta
from typing import Any


ARCHETYPE_TARGET_MIX = {
    "showcase": 0.24,
    "conversation": 0.22,
    "story": 0.18,
    "evergreen": 0.16,
    "authority": 0.12,
    "conversion": 0.08,
}

MIN_REFRESH_GAP_DAYS = 14
HARD_REPEAT_COOLDOWN_HOURS = 12


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(str(value).strip() or default)
    except Exception:
        return default


def safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(str(value).strip() or default))
    except Exception:
        return default


def boolish(value: Any) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


def parse_dt(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def is_dead_or_retired(row: dict[str, Any]) -> bool:
    retired = boolish(row.get("retired", "no"))
    retired_reason = str(row.get("retired_reason", "")).strip().lower()
    state = str(row.get("state", "")).strip().lower()
    return retired or retired_reason == "dead_tweet" or state in {"dead_tweet", "retired"}


def gravity_tier_multiplier(row: dict[str, Any]) -> float:
    gravity_tier = str(row.get("gravity_tier", "standard")).strip().lower() or "standard"
    gravity_score = safe_float(row.get("gravity_score", row.get("score", 0)), 0.0)

    if gravity_tier == "gravity":
        return 1.44 if gravity_score >= 300 else 1.30
    if gravity_tier == "strong":
        return 1.20 if gravity_score >= 150 else 1.12
    if gravity_tier == "archive_candidate":
        return 0.55
    return 1.0


def archive_signal_multiplier(row: dict[str, Any]) -> float:
    archive_signal = safe_float(row.get("archive_signal", 0), 0.0)
    gravity_tier = str(row.get("gravity_tier", "standard")).strip().lower() or "standard"

    if gravity_tier in {"gravity", "strong"}:
        return 1.0
    if archive_signal >= 0.85:
        return 0.40
    if archive_signal >= 0.65:
        return 0.60
    if archive_signal >= 0.45:
        return 0.82
    return 1.0


def media_priority_multiplier(row: dict[str, Any]) -> float:
    media_type = str(row.get("media_type", "") or "").strip().lower()
    has_media = boolish(row.get("has_media"))

    if any(token in media_type for token in ["video", "animated_gif", "gif", "clip", "reel", "mp4"]):
        return 1.34
    if has_media:
        return 1.10
    return 1.0


def recent_archetype_distribution(rows: list[dict[str, Any]], lookback_count: int = 56) -> dict[str, float]:
    recent = sorted(
        [r for r in rows if str(r.get("last_retweeted_at", "")).strip() and not is_dead_or_retired(r)],
        key=lambda r: str(r.get("last_retweeted_at", "")),
        reverse=True,
    )[:lookback_count]

    counter = Counter()
    total = 0
    for row in recent:
        archetype = str(row.get("archetype", "")).strip().lower()
        if not archetype:
            continue
        counter[archetype] += 1
        total += 1

    if total == 0:
        return {}

    return {k: v / total for k, v in counter.items()}


def archetype_mix_multiplier(row: dict[str, Any], rows: list[dict[str, Any]]) -> float:
    archetype = str(row.get("archetype", "")).strip().lower()
    if not archetype or archetype not in ARCHETYPE_TARGET_MIX:
        return 1.0

    dist = recent_archetype_distribution(rows)
    actual = dist.get(archetype, 0.0)
    target = ARCHETYPE_TARGET_MIX[archetype]

    if actual < target * 0.75:
        return 1.18
    if actual < target:
        return 1.08
    if actual > target * 1.35:
        return 0.82
    if actual > target * 1.15:
        return 0.92
    return 1.0


def cooldown_multiplier(row: dict[str, Any]) -> float:
    last_retweeted_at = parse_dt(row.get("last_retweeted_at"))
    if not last_retweeted_at:
        return 1.0

    now = datetime.utcnow()
    delta = now - last_retweeted_at

    if delta < timedelta(hours=HARD_REPEAT_COOLDOWN_HOURS):
        return 0.08
    if delta < timedelta(days=MIN_REFRESH_GAP_DAYS):
        return 0.55
    return 1.0


def gravity_curve(score: float) -> float:
    """
    S-shaped lift:
    - weak posts still have a path
    - mid/high performers get noticeably more pull
    - extreme outliers do not explode infinitely
    """
    normalized = max(0.0, min(score / 300.0, 2.0))
    return 0.75 + (2.35 / (1 + math.exp(-4.2 * (normalized - 0.72))))


def velocity_synergy_multiplier(row: dict[str, Any]) -> float:
    predicted_velocity = safe_float(row.get("predicted_velocity", 0), 0.0)
    engagement_rate = safe_float(row.get("engagement_rate", 0), 0.0)
    score = safe_float(row.get("score", 0), 0.0)

    if score >= 180 and predicted_velocity >= 2.2:
        return 1.18
    if score >= 120 and predicted_velocity >= 1.4:
        return 1.10
    if score >= 80 and engagement_rate >= 0.035:
        return 1.08
    return 1.0


def neglect_boost_multiplier(row: dict[str, Any]) -> float:
    last_retweeted_at = parse_dt(row.get("last_retweeted_at"))
    if not last_retweeted_at:
        return 1.12

    delta_days = (datetime.utcnow() - last_retweeted_at).days
    if delta_days >= 45:
        return 1.20
    if delta_days >= 30:
        return 1.12
    if delta_days >= 21:
        return 1.06
    return 1.0


def ghost_tweet_multiplier(row: dict[str, Any]) -> float:
    impressions = safe_float(row.get("impressions", 0), 0.0)
    refresh_count = safe_int(row.get("refresh_count", 0), 0)
    tweet_age_hours = safe_float(row.get("tweet_age_hours", 0), 0.0)

    if tweet_age_hours < 72:
        return 1.0
    if impressions < 50 and refresh_count >= 4:
        return 0.25
    if impressions < 120 and refresh_count >= 4:
        return 0.40
    if impressions < 200 and refresh_count >= 4:
        return 0.55
    if impressions < 400 and refresh_count >= 6:
        return 0.75
    return 1.0


def row_selection_weight(row: dict[str, Any], rows: list[dict[str, Any]]) -> float:
    if is_dead_or_retired(row):
        return 0.0

    score = safe_float(row.get("score", 0), 0.0)
    predicted_velocity = safe_float(row.get("predicted_velocity", 0), 0.0)
    bookmark_rate = safe_float(row.get("bookmark_rate", 0), 0.0)
    profile_visit_rate = safe_float(row.get("profile_visit_rate", 0), 0.0)
    engagement_rate = safe_float(row.get("engagement_rate", 0), 0.0)
    revival_score = safe_float(row.get("revival_score", 0), 0.0)
    pair_memory_score = safe_float(row.get("pair_memory_score", 0), 0.0)
    refresh_count = safe_int(row.get("refresh_count", 0), 0)
    tweet_age_hours = safe_float(row.get("tweet_age_hours", 0), 0.0)
    underperform = str(row.get("underperform", "no")).strip().lower()
    strong_reviver = str(row.get("strong_reviver", "no")).strip().lower()

    weight = 1.0

    # upgraded gravity curve
    weight *= gravity_curve(score)

    # additive quality signals
    weight += min(2.6, predicted_velocity * 0.36)
    weight += min(1.9, engagement_rate * 10.5)
    weight += min(1.6, bookmark_rate * 820.0)
    weight += min(1.6, profile_visit_rate * 670.0)
    weight += min(1.25, revival_score / 120.0)
    weight += min(0.85, pair_memory_score / 15.0)

    # stronger rescue for legitimate revivers
    if revival_score >= 180:
        weight *= 1.22
    elif revival_score >= 120:
        weight *= 1.12

    if strong_reviver == "yes":
        weight *= 1.15

    if underperform == "yes":
        weight *= 0.72

    # evergreen age shaping
    if tweet_age_hours >= 24 * 21:
        weight *= 1.18
    elif tweet_age_hours <= 24:
        weight *= 0.84

    # prevent overuse
    if refresh_count >= 8:
        weight *= 0.74
    elif refresh_count >= 4:
        weight *= 0.88

    # constellation mode extras
    weight *= velocity_synergy_multiplier(row)
    weight *= neglect_boost_multiplier(row)

    # ghost tweet protection
    weight *= ghost_tweet_multiplier(row)

    # existing ecosystem controls
    weight *= media_priority_multiplier(row)
    weight *= gravity_tier_multiplier(row)
    weight *= archive_signal_multiplier(row)
    weight *= archetype_mix_multiplier(row, rows)
    weight *= cooldown_multiplier(row)

    return max(0.05, round(weight, 5))


def selection_reason_summary(row: dict[str, Any]) -> str:
    parts: list[str] = []

    gravity_tier = str(row.get("gravity_tier", "standard")).strip().lower()
    archetype = str(row.get("archetype", "")).strip().lower()
    funnel_stage = str(row.get("funnel_stage", "")).strip()

    if gravity_tier and gravity_tier != "standard":
        parts.append(gravity_tier)

    if archetype:
        parts.append(archetype)

    if funnel_stage:
        parts.append(f"stage {funnel_stage}")

    media_type = str(row.get("media_type", "") or "").strip().lower()
    if any(token in media_type for token in ["video", "animated_gif", "gif", "clip", "reel", "mp4"]):
        parts.append("video priority")

    predicted_velocity = safe_float(row.get("predicted_velocity", 0), 0.0)
    bookmark_rate = safe_float(row.get("bookmark_rate", 0), 0.0)
    profile_visit_rate = safe_float(row.get("profile_visit_rate", 0), 0.0)
    revival_score = safe_float(row.get("revival_score", 0), 0.0)
    impressions = safe_float(row.get("impressions", 0), 0.0)
    refresh_count = safe_int(row.get("refresh_count", 0), 0)

    if predicted_velocity >= 2.0:
        parts.append("velocity lift")
    if bookmark_rate >= 0.008:
        parts.append("bookmark pull")
    if profile_visit_rate >= 0.006:
        parts.append("profile pull")
    if revival_score >= 120:
        parts.append("revival lift")
    if impressions < 200 and refresh_count >= 4:
        parts.append("ghost-risk muted")

    return " | ".join(parts) if parts else "balanced weighted pick"


def choose_row(eligible_rows: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, str, str]:
    if not eligible_rows:
        return None, "No eligible posts", "Pool empty"

    live_rows = [row for row in eligible_rows if not is_dead_or_retired(row)]
    if not live_rows:
        return None, "No eligible posts", "Only retired/dead rows remained"

    weighted_rows: list[dict[str, Any]] = []
    weights: list[float] = []

    for row in live_rows:
        weight = row_selection_weight(row, live_rows)
        if weight <= 0:
            continue

        # orbit stabilizer
        refresh_count = safe_int(row.get("refresh_count", 0), 0)
        if refresh_count >= 12:
            weight *= 0.65
        elif refresh_count >= 6:
            weight *= 0.82

        weighted_rows.append(row)
        weights.append(weight)

    if not weighted_rows:
        return None, "No eligible posts", "All candidate weights collapsed to zero"

    chosen = random.choices(weighted_rows, weights=weights, k=1)[0]

    strategy = "Constellation circulation"
    reason = selection_reason_summary(chosen)
    return chosen, strategy, reason
