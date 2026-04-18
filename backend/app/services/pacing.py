from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
import random


@dataclass(frozen=True)
class PacingProfile:
    mode: str
    min_minutes: int
    max_minutes: int
    label: str
    display_name: str
    description: str


LIGHT_X = PacingProfile(
    mode="light",
    min_minutes=45,
    max_minutes=90,
    label="Light · 45–90 min",
    display_name="Conservative",
    description="Softer repost cadence for a lighter X footprint.",
)

STANDARD_X = PacingProfile(
    mode="standard",
    min_minutes=24,
    max_minutes=49,
    label="Standard · 24–49 min",
    display_name="Moderate",
    description="Balanced X cadence for steady resurfacing.",
)

HEAVY_X = PacingProfile(
    mode="heavy",
    min_minutes=12,
    max_minutes=24,
    label="Heavy · 12–24 min",
    display_name="Active",
    description="Faster X cadence for stronger circulation pressure.",
)

LIGHT_BLUESKY = PacingProfile(
    mode="light",
    min_minutes=60,
    max_minutes=120,
    label="Light · 60–120 min",
    display_name="Conservative",
    description="Longer Bluesky spacing for softer recirculation.",
)

STANDARD_BLUESKY = PacingProfile(
    mode="standard",
    min_minutes=35,
    max_minutes=75,
    label="Standard · 35–75 min",
    display_name="Moderate",
    description="Balanced Bluesky cadence for regular resurfacing.",
)

HEAVY_BLUESKY = PacingProfile(
    mode="heavy",
    min_minutes=18,
    max_minutes=36,
    label="Heavy · 18–36 min",
    display_name="Active",
    description="Faster Bluesky cadence for aggressive recycling.",
)

BALANCED = STANDARD_X


def _safe_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _joined_text(*parts) -> str:
    return " ".join(str(p or "") for p in parts).strip().lower()


def normalize_provider(provider: str | None) -> str:
    raw = str(provider or "x").strip().lower()
    if raw in {"bluesky", "bsky"}:
        return "bluesky"
    return "x"


def normalize_mode(mode: str | None) -> str:
    raw = str(mode or "standard").strip().lower()
    if raw in {"light", "gentle"}:
        return "light"
    if raw in {"heavy", "viral"}:
        return "heavy"
    return "standard"


def get_profile_for_mode(provider: str | None, mode: str | None) -> PacingProfile:
    provider_key = normalize_provider(provider)
    mode_key = normalize_mode(mode)

    if provider_key == "bluesky":
        if mode_key == "light":
            return LIGHT_BLUESKY
        if mode_key == "heavy":
            return HEAVY_BLUESKY
        return STANDARD_BLUESKY

    if mode_key == "light":
        return LIGHT_X
    if mode_key == "heavy":
        return HEAVY_X
    return STANDARD_X


def pacing_options_for_provider(provider: str | None) -> list[dict]:
    provider_key = normalize_provider(provider)
    profiles = (
        [LIGHT_BLUESKY, STANDARD_BLUESKY, HEAVY_BLUESKY]
        if provider_key == "bluesky"
        else [LIGHT_X, STANDARD_X, HEAVY_X]
    )

    return [
        {
            "mode": p.mode,
            "min_minutes": p.min_minutes,
            "max_minutes": p.max_minutes,
            "label": p.label,
            "display_name": p.display_name,
            "description": p.description,
        }
        for p in profiles
    ]


def pacing_payload(provider: str | None, mode: str | None) -> dict:
    profile = get_profile_for_mode(provider, mode)
    return {
        "pacing_mode": profile.mode,
        "pacing_label": profile.display_name,
        "pacing_description": profile.description,
        "pacing_window_label": profile.label,
        "pacing_options": pacing_options_for_provider(provider),
    }


def choose_next_cycle(
    provider: str | None,
    mode: str | None,
    *,
    from_dt: datetime | None = None,
) -> tuple[datetime, int]:
    profile = get_profile_for_mode(provider, mode)
    delay_minutes = random.randint(profile.min_minutes, profile.max_minutes)
    anchor = from_dt or datetime.utcnow()
    return anchor + timedelta(minutes=delay_minutes), delay_minutes


def choose_pacing_profile(
    post=None,
    payload: dict | None = None,
    *,
    provider: str | None = None,
    explicit_mode: str | None = None,
) -> tuple[PacingProfile, str]:
    payload = payload or {}

    if explicit_mode:
        profile = get_profile_for_mode(provider, explicit_mode)
        return profile, f"manual pacing mode: {profile.mode}"

    strategy = getattr(post, "strategy", "") or payload.get("strategy", "")
    reason = getattr(post, "reason", "") or payload.get("reason", "")
    text = getattr(post, "text", "") or payload.get("text", "")
    blob = _joined_text(strategy, reason, text, payload.get("signal"), payload.get("note"))

    like_velocity = _safe_float(payload.get("like_velocity"))
    reply_velocity = _safe_float(payload.get("reply_velocity"))
    repost_velocity = _safe_float(payload.get("repost_velocity"))
    watch_completion = _safe_float(payload.get("watch_completion"))

    hot_keywords = [
        "viral",
        "spike",
        "breakout",
        "amplification",
        "momentum",
        "surge",
        "high velocity",
        "accelerating",
        "top performer",
        "hot post",
    ]
    soft_keywords = [
        "gentle",
        "slow burn",
        "cooldown",
        "archive",
        "evergreen long-tail",
        "low priority",
        "light",
    ]

    if any(keyword in blob for keyword in hot_keywords):
        profile = get_profile_for_mode(provider, "heavy")
        return profile, "keyword-triggered heavy pacing"

    if (
        like_velocity >= 12
        or reply_velocity >= 4
        or repost_velocity >= 3
        or watch_completion >= 0.70
    ):
        profile = get_profile_for_mode(provider, "heavy")
        return profile, "engagement spike detected"

    if any(keyword in blob for keyword in soft_keywords):
        profile = get_profile_for_mode(provider, "light")
        return profile, "soft-circulation keyword match"

    profile = get_profile_for_mode(provider, "standard")
    return profile, "standard circulation"
