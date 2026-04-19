from __future__ import annotations

import random
import re
from datetime import datetime, timedelta, UTC
from typing import Any

from app.core.db import SessionLocal
from app.core.subscription_state import ensure_user_subscription_state
from app.models.models import AutopilotStatus, ConnectedAccount, Post, User
from app.services.job_queue import (
    claim_next_jobs,
    complete_job,
    fail_job,
    find_active_job,
    load_jobs,
    enqueue_job,
)
from app.services.pacing import (
    BALANCED,
    choose_pacing_profile,
    get_profile_for_mode,
    normalize_mode,
)
from app.services.scoring import (
    _bluesky_post_is_original,
    _x_post_is_original,
    record_resurfaced_post,
    select_next_post,
    seed_demo_data,
)
from app.services.x_refresh_service import refresh_repost

try:
    from app.services.bluesky_refresh_service import refresh_repost as bluesky_refresh_repost
except Exception:
    bluesky_refresh_repost = None

from app.services.bluesky_import_service import import_bluesky_demo_posts
from app.services.x_import_service import import_x_pool_posts


MAINTENANCE_MIN_HOURS = 4
MAINTENANCE_MAX_HOURS = 8
SCHEDULE_REPAIR_GRACE_MINUTES = 5
INITIAL_REFRESH_MIN_MINUTES = 1
INITIAL_REFRESH_MAX_MINUTES = 3
MOMENTUM_STACK_COUNT = 2
VELOCITY_STACK_COUNT = 4
PAIR_MIN_DELAY_MINUTES = 1
PAIR_MAX_DELAY_MINUTES = 2
MOMENTUM_MIN_DELAY_MINUTES = 2
MOMENTUM_MAX_DELAY_MINUTES = 5
VELOCITY_MIN_DELAY_MINUTES = 1
VELOCITY_MAX_DELAY_MINUTES = 3
VIRAL_ENGAGEMENT_RATE_THRESHOLD = 6.0
VIRAL_IMPRESSIONS_THRESHOLD = 15000
PROFILE_SURGE_RATE_THRESHOLD = 0.010
ANALYTICS_REFRESH_THRESHOLD_HOURS = 6
X_FRESH_POST_BREATHING_HOURS = 10
BLUESKY_FRESH_POST_BREATHING_HOURS = 8


def _stage(message: str, events: list[str]) -> None:
    events.append(message)
    print(f"[evergreen][cycle] {message}")


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value or default)
    except Exception:
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value or default))
    except Exception:
        return default


def _boolish(value: Any) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


def _sanitize_post_id(raw_value, provider: str | None = None) -> str:
    value = str(raw_value or "").strip()
    if not value:
        return ""

    provider_key = str(provider or "").strip().lower()

    if value.startswith("at://") or provider_key in {"bluesky", "bsky"}:
        return value

    if value.upper().startswith("RT "):
        value = value[3:].strip()

    match = re.search(r"(\d{8,})", value)
    if match:
        return match.group(1)

    return value


def _utc_now_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _choose_refresh_time(min_minutes: int, max_minutes: int) -> tuple[datetime, int]:
    low = max(1, int(min_minutes))
    high = max(low, int(max_minutes))
    delay_minutes = random.randint(low, high)
    return _utc_now_naive() + timedelta(minutes=delay_minutes), delay_minutes


def _choose_maintenance_time() -> tuple[datetime, int]:
    delay_hours = random.randint(MAINTENANCE_MIN_HOURS, MAINTENANCE_MAX_HOURS)
    return _utc_now_naive() + timedelta(hours=delay_hours), delay_hours


def _refresh_count_last_24h(connected_account_id: int) -> int:
    now = _utc_now_naive()
    cutoff = now - timedelta(hours=24)
    total = 0
    for job in load_jobs():
        try:
            if int(job.get("connected_account_id", -1)) != int(connected_account_id):
                continue
            if str(job.get("job_type", "")) != "refresh":
                continue
            if str(job.get("status", "")) != "completed":
                continue
            finished_at_raw = str(job.get("finished_at") or "").strip()
            if not finished_at_raw:
                continue
            finished_at = datetime.fromisoformat(finished_at_raw)
            if finished_at >= cutoff:
                total += 1
        except Exception:
            continue
    return total


def _get_account_context(db, connected_account_id: int) -> tuple[ConnectedAccount, User, AutopilotStatus]:
    account = db.query(ConnectedAccount).filter(ConnectedAccount.id == connected_account_id).first()
    if not account:
        raise ValueError(f"connected account {connected_account_id} not found")
    user = db.query(User).filter(User.id == account.user_id).first()
    if not user:
        raise ValueError(f"user {account.user_id} not found for connected account {connected_account_id}")
    autopilot = db.query(AutopilotStatus).filter(AutopilotStatus.connected_account_id == connected_account_id).first()
    if not autopilot:
        raise ValueError(f"autopilot state missing for connected account {connected_account_id}")
    return account, user, autopilot


def _candidate_strength(post) -> str:
    score = float(getattr(post, "score", 0) or 0)
    if score >= 250:
        return "hot"
    if score >= 120:
        return "warm"
    return "steady"


def _account_pacing_mode(account: ConnectedAccount | None) -> str:
    metadata = (account.metadata_json or {}) if account else {}
    return normalize_mode(metadata.get("pacing_mode"))


def _get_autopilot_metadata(autopilot: AutopilotStatus) -> dict[str, Any]:
    raw = getattr(autopilot, "metadata_json", None)
    if isinstance(raw, dict):
        return dict(raw)
    return {}


def _set_autopilot_metadata(autopilot: AutopilotStatus, metadata: dict[str, Any]) -> None:
    if hasattr(autopilot, "metadata_json"):
        autopilot.metadata_json = metadata


def _parse_iso_naive(value: object) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except Exception:
        return None


def _mode_delay_override(metadata: dict[str, Any]) -> tuple[int, int] | None:
    pending_pair_id = str(metadata.get("pending_pair_post_id", "") or "").strip()
    if pending_pair_id:
        return PAIR_MIN_DELAY_MINUTES, PAIR_MAX_DELAY_MINUTES

    if _boolish(metadata.get("velocity_stack_active", False)) and _safe_int(metadata.get("momentum_stack_remaining", 0), 0) > 0:
        return VELOCITY_MIN_DELAY_MINUTES, VELOCITY_MAX_DELAY_MINUTES

    if _safe_int(metadata.get("momentum_stack_remaining", 0), 0) > 0:
        return MOMENTUM_MIN_DELAY_MINUTES, MOMENTUM_MAX_DELAY_MINUTES

    return None


def _persist_refresh_schedule(
    db,
    autopilot: AutopilotStatus,
    *,
    next_refresh_at: datetime,
    next_delay_minutes: int,
    pacing_mode: str,
    result_message: str | None = None,
) -> None:
    next_maintenance_at, next_maintenance_delay_hours = _choose_maintenance_time()
    autopilot.next_cycle_at = next_refresh_at
    metadata = _get_autopilot_metadata(autopilot)
    metadata["next_refresh_at"] = next_refresh_at.isoformat()
    metadata["next_refresh_delay_minutes"] = next_delay_minutes
    metadata["next_maintenance_at"] = next_maintenance_at.isoformat()
    metadata["next_maintenance_delay_hours"] = next_maintenance_delay_hours
    metadata["pacing_mode"] = normalize_mode(pacing_mode)
    if result_message:
        metadata["last_refresh_message"] = result_message
    _set_autopilot_metadata(autopilot, metadata)
    db.commit()
    db.refresh(autopilot)


def _effective_pacing_mode(autopilot: AutopilotStatus, account: ConnectedAccount | None) -> str:
    metadata = _get_autopilot_metadata(autopilot)
    persisted_mode = normalize_mode(metadata.get("pacing_mode"))
    if persisted_mode:
        return persisted_mode
    return _account_pacing_mode(account)


def _ensure_refresh_schedule_for_account(
    db,
    autopilot: AutopilotStatus,
    account: ConnectedAccount | None,
) -> tuple[datetime | None, bool]:
    existing_refresh_dt = getattr(autopilot, "next_cycle_at", None)
    if not account:
        return existing_refresh_dt, False
    pacing_mode = _effective_pacing_mode(autopilot, account)
    profile = get_profile_for_mode(account.provider, pacing_mode)
    now = _utc_now_naive()
    if existing_refresh_dt is None:
        metadata = _get_autopilot_metadata(autopilot)
        existing_refresh_dt = _parse_iso_naive(metadata.get("next_refresh_at"))
    if existing_refresh_dt is not None and existing_refresh_dt <= now:
        return existing_refresh_dt, False
    if existing_refresh_dt is None:
        next_refresh_at, next_delay_minutes = _choose_refresh_time(profile.min_minutes, profile.max_minutes)
        _persist_refresh_schedule(
            db,
            autopilot,
            next_refresh_at=next_refresh_at,
            next_delay_minutes=next_delay_minutes,
            pacing_mode=pacing_mode,
            result_message="refresh schedule initialized",
        )
        return next_refresh_at, True
    return existing_refresh_dt, False


def _analytics_refresh_cutoff() -> datetime:
    return _utc_now_naive() - timedelta(hours=ANALYTICS_REFRESH_THRESHOLD_HOURS)


def _analytics_is_stale(autopilot: AutopilotStatus) -> tuple[bool, str]:
    metadata = _get_autopilot_metadata(autopilot)
    last_analytics_at = _parse_iso_naive(metadata.get("last_analytics_at"))
    posts_in_rotation = max(0, int(getattr(autopilot, "posts_in_rotation", 0) or 0))

    if posts_in_rotation <= 0:
        return True, "pool empty"
    if last_analytics_at is None:
        return True, "analytics missing"
    if last_analytics_at <= _analytics_refresh_cutoff():
        return True, "analytics stale"
    return False, ""


def _fresh_post_protection_enabled(account: ConnectedAccount | None) -> bool:
    metadata = dict((account.metadata_json or {}) if account else {})
    raw = metadata.get("fresh_post_protection_enabled")
    if raw is None:
        return True
    return _boolish(raw) if isinstance(raw, str) else bool(raw)


def _fresh_post_breathing_hours(provider: str | None) -> int:
    key = str(provider or "").strip().lower()
    if key == "bluesky":
        return BLUESKY_FRESH_POST_BREATHING_HOURS
    return X_FRESH_POST_BREATHING_HOURS


def _is_original_post_for_provider(post: Post, provider: str | None) -> bool:
    key = str(provider or "").strip().lower()
    if key == "bluesky":
        return _bluesky_post_is_original(post)
    return _x_post_is_original(post)


def _latest_original_post(db, connected_account_id: int, provider: str | None) -> Post | None:
    posts = (
        db.query(Post)
        .filter(
            Post.connected_account_id == connected_account_id,
            Post.state == "active",
        )
        .order_by(Post.created_at.desc(), Post.id.desc())
        .all()
    )
    for post in posts:
        if _is_original_post_for_provider(post, provider):
            return post
    return None


def _clear_breathing_room_metadata(autopilot: AutopilotStatus) -> dict[str, Any]:
    metadata = _get_autopilot_metadata(autopilot)
    metadata["breathing_room_active"] = False
    metadata["breathing_room_until"] = ""
    metadata["breathing_room_reason"] = ""
    metadata["latest_original_post_at"] = ""
    metadata["latest_original_post_id"] = ""
    return metadata


def _evaluate_breathing_room(
    db,
    autopilot: AutopilotStatus,
    account: ConnectedAccount,
) -> dict[str, Any]:
    metadata = _clear_breathing_room_metadata(autopilot)
    provider = str(account.provider or autopilot.provider or "x").strip().lower()
    protection_enabled = _fresh_post_protection_enabled(account)
    metadata["fresh_post_protection_enabled"] = protection_enabled

    latest_original = _latest_original_post(db, int(account.id), provider)
    if latest_original and getattr(latest_original, "created_at", None):
        latest_original_at = latest_original.created_at
        metadata["latest_original_post_at"] = latest_original_at.isoformat()
        metadata["latest_original_post_id"] = str(getattr(latest_original, "provider_post_id", "") or "").strip()

        breathing_until = latest_original_at + timedelta(hours=_fresh_post_breathing_hours(provider))
        if protection_enabled and breathing_until > _utc_now_naive():
            metadata["breathing_room_active"] = True
            metadata["breathing_room_until"] = breathing_until.isoformat()
            metadata["breathing_room_reason"] = "recent original post"

    _set_autopilot_metadata(autopilot, metadata)
    db.commit()
    db.refresh(autopilot)
    return metadata


def _hold_for_breathing_room(
    db,
    autopilot: AutopilotStatus,
    account: ConnectedAccount,
    metadata: dict[str, Any],
    events: list[str],
) -> dict[str, Any]:
    breathing_until = _parse_iso_naive(metadata.get("breathing_room_until"))
    if not breathing_until:
        raise ValueError("breathing room hold requested without a valid resume time")

    next_delay_minutes = max(1, int((breathing_until - _utc_now_naive()).total_seconds() // 60) + 1)
    result_message = "breathing room active for recent original post"
    _persist_refresh_schedule(
        db,
        autopilot,
        next_refresh_at=breathing_until,
        next_delay_minutes=next_delay_minutes,
        pacing_mode=_effective_pacing_mode(autopilot, account),
        result_message=result_message,
    )
    events.append("breathing room active")
    return {
        "connected_account_id": int(account.id),
        "user_id": int(account.user_id),
        "handle": account.handle,
        "provider": account.provider,
        "message": result_message,
        "last_action_at": autopilot.last_action_at.isoformat() if autopilot.last_action_at else None,
        "next_cycle_at": autopilot.next_cycle_at.isoformat() if autopilot.next_cycle_at else None,
        "last_post_text": autopilot.last_post_text,
        "cycle_events": events,
        "pacing_mode": _effective_pacing_mode(autopilot, account),
        "pacing_reason": "fresh post breathing room",
        "next_delay_minutes": next_delay_minutes,
        "candidate_strength": "steady",
        "rotation_health": {
            "pool_size": int(autopilot.posts_in_rotation or 0),
            "refreshes_last_24h": _refresh_count_last_24h(int(account.id)),
            "last_strategy": _get_autopilot_metadata(autopilot).get("last_strategy", "Constellation circulation"),
            "mix_hint": "Fresh-post protection active",
        },
    }


def _run_analytics_sync(
    db,
    *,
    connected_account_id: int,
    source: str = "manual",
    reason: str = "",
) -> dict:
    seed_demo_data(db)
    account, user, autopilot = _get_account_context(db, connected_account_id)
    analytics_started_at = _utc_now_naive()
    autopilot.last_action_at = analytics_started_at
    cycle_events = ["analytics started"]
    message = "analytics job placeholder complete"
    next_step = "wire import + analytics engine + pool rebuild"
    provider = (account.provider or "").lower()
    imported: dict[str, Any] = {}

    if provider == "bluesky":
        imported = import_bluesky_demo_posts(
            db,
            user_id=user.id,
            connected_account_id=connected_account_id,
            handle=account.handle,
        )
        autopilot.posts_in_rotation = int(imported["total_posts"])
        message = f"Bluesky importer complete: +{imported['imported']} new, {imported['updated']} updated"
        next_step = "Bluesky posts are now in the Evergreen pool"
        cycle_events.extend(["bluesky import started", "bluesky import completed"])
    elif provider == "x":
        imported = import_x_pool_posts(
            db,
            user_id=user.id,
            connected_account_id=connected_account_id,
            handle=account.handle,
        )
        autopilot.posts_in_rotation = int(imported["active_posts"])
        message = (
            f"X importer complete: +{imported['imported']} new, "
            f"{imported['updated']} updated, fetched {imported.get('fetched', 0)}"
        )
        if imported.get("fallback_limited"):
            message += " (v1 fallback unavailable on current X access tier)"
        next_step = "X posts are now in the Evergreen galaxy"
        cycle_events.extend(["x import started", "x import completed"])

    metadata = _get_autopilot_metadata(autopilot)
    metadata["last_analytics_at"] = analytics_started_at.isoformat()
    metadata["last_analytics_source"] = source
    if reason:
        metadata["last_analytics_reason"] = reason
    _set_autopilot_metadata(autopilot, metadata)

    db.commit()
    db.refresh(autopilot)
    return {
        "connected_account_id": connected_account_id,
        "user_id": user.id,
        "handle": account.handle,
        "provider": account.provider,
        "message": message,
        "next_step": next_step,
        "last_action_at": autopilot.last_action_at.isoformat() if autopilot.last_action_at else None,
        "cycle_events": cycle_events + ["analytics completed"],
        "debug_notes": imported.get("debug_notes", []),
        "pacing_mode": _effective_pacing_mode(autopilot, account),
        "pacing_reason": "account-selected pacing",
        "next_delay_minutes": 0,
        "candidate_strength": "steady",
        "rotation_health": {
            "pool_size": int(autopilot.posts_in_rotation or 0),
            "refreshes_last_24h": _refresh_count_last_24h(connected_account_id),
            "last_strategy": _get_autopilot_metadata(autopilot).get("last_strategy", "Constellation circulation"),
            "mix_hint": "Mixed media ready",
        },
    }


def _record_selection_metadata(db, autopilot: AutopilotStatus, account: ConnectedAccount, post) -> dict[str, Any]:
    metadata = _get_autopilot_metadata(autopilot)
    raw = dict(getattr(post, "raw", None) or {})
    strategy = str(getattr(post, "strategy", "") or "Constellation circulation").strip()
    reason = str(getattr(post, "reason", "") or "balanced weighted pick").strip()
    metadata["last_strategy"] = strategy
    metadata["last_selection_reason"] = reason
    metadata["last_candidate_provider_post_id"] = str(getattr(post, "provider_post_id", "") or "").strip()
    metadata["last_candidate_score"] = float(getattr(post, "score", 0) or raw.get("score", 0) or 0)
    metadata["last_candidate_funnel_stage"] = str(raw.get("funnel_stage", "") or "").strip()
    metadata["last_candidate_gravity_tier"] = str(raw.get("gravity_tier", "") or "").strip()
    metadata["last_candidate_predicted_velocity"] = _safe_float(raw.get("predicted_velocity", 0), 0.0)
    metadata["provider"] = str(account.provider or metadata.get("provider") or "").strip().lower() or "x"
    _set_autopilot_metadata(autopilot, metadata)
    db.commit()
    db.refresh(autopilot)
    return metadata


def _is_profile_surge_candidate(raw: dict[str, Any]) -> bool:
    return _safe_float(raw.get("profile_visit_rate", 0), 0.0) >= PROFILE_SURGE_RATE_THRESHOLD


def _is_viral_candidate(raw: dict[str, Any]) -> bool:
    return (
        _safe_float(raw.get("engagement_rate", 0), 0.0) >= VIRAL_ENGAGEMENT_RATE_THRESHOLD
        and _safe_float(raw.get("impressions", 0), 0.0) >= VIRAL_IMPRESSIONS_THRESHOLD
    )


def _apply_growth_modes(db, autopilot: AutopilotStatus, post) -> dict[str, Any]:
    metadata = _get_autopilot_metadata(autopilot)
    raw = dict(getattr(post, "raw", None) or {})
    selected_id = str(getattr(post, "provider_post_id", "") or "").strip()

    if str(metadata.get("pending_pair_post_id", "") or "").strip() == selected_id:
        metadata["pending_pair_post_id"] = ""
        metadata["pending_pair_anchor_id"] = ""
        metadata["pending_pair_reason"] = ""
        metadata["pending_pair_target_stage"] = ""
        metadata["current_chain_depth"] = max(1, _safe_int(metadata.get("current_chain_depth", 1), 1))
    else:
        pair_partner_id = str(raw.get("pair_partner_id", "") or "").strip()
        if pair_partner_id:
            metadata["pending_pair_post_id"] = pair_partner_id
            metadata["pending_pair_anchor_id"] = selected_id
            metadata["pending_pair_reason"] = "pair memory follow-up"
            metadata["pending_pair_target_stage"] = str(raw.get("funnel_stage", "") or "").strip() or ""
            metadata["current_chain_depth"] = max(2, _safe_int(metadata.get("current_chain_depth", 1), 1) + 1)

    if _is_viral_candidate(raw):
        metadata["velocity_stack_active"] = True
        metadata["momentum_stack_remaining"] = VELOCITY_STACK_COUNT
        metadata["last_momentum_reason"] = "viral amplification"
    elif _is_profile_surge_candidate(raw) or _safe_float(raw.get("predicted_velocity", 0), 0.0) >= 1.2:
        remaining = _safe_int(metadata.get("momentum_stack_remaining", 0), 0)
        metadata["velocity_stack_active"] = _boolish(metadata.get("velocity_stack_active", False))
        metadata["momentum_stack_remaining"] = max(remaining, MOMENTUM_STACK_COUNT)
        metadata["last_momentum_reason"] = "profile/velocity lift"
    else:
        remaining = _safe_int(metadata.get("momentum_stack_remaining", 0), 0)
        if remaining > 0:
            metadata["momentum_stack_remaining"] = remaining - 1
            if metadata["momentum_stack_remaining"] <= 0:
                metadata["velocity_stack_active"] = False
                metadata["last_momentum_reason"] = ""

    metadata["last_selected_at"] = _utc_now_naive().isoformat()
    _set_autopilot_metadata(autopilot, metadata)
    db.commit()
    db.refresh(autopilot)
    return metadata


def _update_autopilot_after_refresh(db, autopilot: AutopilotStatus, post, result_message: str, pacing_mode: str, min_minutes: int, max_minutes: int):
    metadata = _get_autopilot_metadata(autopilot)
    override = _mode_delay_override(metadata)
    if override:
        min_minutes, max_minutes = override
    next_refresh_at, next_delay_minutes = _choose_refresh_time(min_minutes, max_minutes)
    autopilot.posts_in_rotation = max(0, int(autopilot.posts_in_rotation or 0))
    autopilot.last_post_text = getattr(post, "text", None) or getattr(post, "provider_post_id", None)
    autopilot.last_action_at = _utc_now_naive()
    _persist_refresh_schedule(
        db,
        autopilot,
        next_refresh_at=next_refresh_at,
        next_delay_minutes=next_delay_minutes,
        pacing_mode=pacing_mode,
        result_message=result_message,
    )
    return (
        autopilot.last_action_at.isoformat() if autopilot.last_action_at else None,
        autopilot.next_cycle_at.isoformat() if autopilot.next_cycle_at else None,
        autopilot.last_post_text,
        next_delay_minutes,
    )


def _print_engine_telemetry(post, account: ConnectedAccount, selection_metadata: dict[str, Any]) -> None:
    raw = dict(getattr(post, "raw", None) or {})
    provider_post_id = str(getattr(post, "provider_post_id", "") or "").strip()
    strategy = str(selection_metadata.get("last_strategy", "") or "Constellation circulation").strip()
    reason = str(selection_metadata.get("last_selection_reason", "") or "balanced weighted pick").strip()
    score = _safe_float(getattr(post, "score", 0), 0.0)
    gravity_tier = str(raw.get("gravity_tier", selection_metadata.get("last_candidate_gravity_tier", "")) or "").strip() or "standard"
    predicted_velocity = _safe_float(raw.get("predicted_velocity", selection_metadata.get("last_candidate_predicted_velocity", 0)), 0.0)
    funnel_stage = str(raw.get("funnel_stage", selection_metadata.get("last_candidate_funnel_stage", "")) or "").strip() or "unassigned"

    print(
        "[evergreen][engine] "
        f"provider={str(account.provider or '').strip().lower() or 'x'} "
        f"candidate={provider_post_id or 'unknown'} "
        f"strategy={strategy} "
        f"reason={reason} "
        f"score={score:.2f} "
        f"gravity={gravity_tier} "
        f"velocity={predicted_velocity:.3f} "
        f"stage={funnel_stage}"
    )


def _is_retryable_refresh_skip(message: str, provider: str) -> bool:
    lowered = str(message or "").strip().lower()
    provider_key = str(provider or "").strip().lower()

    if provider_key != "x":
        return False

    return (
        "state sync delay" in lowered
        or "still thinks it is retweeted" in lowered
        or "retweet verification never cleared" in lowered
    )


def _run_refresh_job(connected_account_id: int, payload: dict | None = None) -> dict:
    db = SessionLocal()
    payload = payload or {}
    events: list[str] = []
    try:
        seed_demo_data(db)
        account, user, autopilot = _get_account_context(db, connected_account_id)
        if not autopilot.connected:
            raise ValueError(f"account {account.handle} is not connected")
        _stage("cycle started", events)
        provider = (autopilot.provider or account.provider or "x").lower()
        if provider not in {"x", "bluesky"}:
            raise ValueError(f"unsupported provider for now: {provider}")
        requested_mode = payload.get("pacing_mode")
        manual_mode = requested_mode or _effective_pacing_mode(autopilot, account)
        analytics_required, analytics_reason = _analytics_is_stale(autopilot)
        if analytics_required:
            _stage(f"refreshing pool + scoring ({analytics_reason})", events)
            analytics_result = _run_analytics_sync(
                db,
                connected_account_id=connected_account_id,
                source=str(payload.get("source") or "autopilot"),
                reason=analytics_reason,
            )
            events.extend(
                [
                    event
                    for event in analytics_result.get("cycle_events", [])
                    if isinstance(event, str) and event not in events
                ]
            )
            account, user, autopilot = _get_account_context(db, connected_account_id)
        breathing_metadata = _evaluate_breathing_room(db, autopilot, account)
        if _boolish(breathing_metadata.get("breathing_room_active", False)):
            _stage("holding for fresh post breathing room", events)
            return _hold_for_breathing_room(db, autopilot, account, breathing_metadata, events)
        excluded_provider_post_ids: set[str] = set()
        post = None
        selection_metadata: dict[str, Any] | None = None
        provider_post_id = ""
        result = None
        pacing_profile = BALANCED
        pacing_reason = "fallback to balanced"

        for selection_attempt in range(1, 5):
            _stage("selecting post", events)
            post = select_next_post(
                db,
                connected_account_id,
                excluded_provider_post_ids=excluded_provider_post_ids,
            )
            if not post:
                if excluded_provider_post_ids:
                    raise ValueError(
                        f"refresh candidates exhausted for {account.handle} after skip retries"
                    )
                raise ValueError(f"no eligible post found for {account.handle}")

            selection_metadata = _record_selection_metadata(db, autopilot, account, post)
            _stage(
                f"selected via {selection_metadata.get('last_strategy', 'Constellation circulation')}",
                events,
            )
            _print_engine_telemetry(post, account, selection_metadata)

            pacing_profile, pacing_reason = choose_pacing_profile(
                post=post,
                payload=payload,
                provider=provider,
                explicit_mode=manual_mode,
            )
            if not pacing_profile:
                pacing_profile = BALANCED
                pacing_reason = "fallback to balanced"

            provider_post_id = _sanitize_post_id(
                getattr(post, "provider_post_id", None) or getattr(post, "text", None),
                provider=provider,
            )
            if not provider_post_id:
                raise ValueError(f"could not derive post id for {account.handle}")

            _stage("publishing refresh", events)
            if provider == "bluesky":
                if bluesky_refresh_repost is None:
                    raise ValueError("Bluesky refresh service is not available yet.")
                result = bluesky_refresh_repost(provider_post_id, account.handle)
            else:
                result = refresh_repost(provider_post_id, account.handle)

            if result.ok:
                break

            if _is_retryable_refresh_skip(result.message, provider):
                excluded_provider_post_ids.add(provider_post_id)
                _stage(f"skipped stuck post {provider_post_id}", events)
                if selection_attempt < 4:
                    continue
            raise ValueError(result.message)

        if not result or not result.ok or not post or not selection_metadata:
            raise ValueError(f"refresh cycle did not complete for {account.handle}")
        _stage("resurfaced post", events)
        record_resurfaced_post(db, connected_account_id, post)
        growth_metadata = _apply_growth_modes(db, autopilot, post)
        last_action_at, next_cycle_at, last_post_text, next_delay_minutes = _update_autopilot_after_refresh(
            db,
            autopilot,
            post,
            result.message,
            pacing_profile.mode,
            pacing_profile.min_minutes,
            pacing_profile.max_minutes,
        )
        return {
            "connected_account_id": connected_account_id,
            "user_id": user.id,
            "handle": account.handle,
            "provider": account.provider,
            "provider_post_id": provider_post_id,
            "message": result.message,
            "last_action_at": last_action_at,
            "next_cycle_at": next_cycle_at,
            "last_post_text": last_post_text,
            "cycle_events": events,
            "pacing_mode": pacing_profile.mode,
            "pacing_reason": pacing_reason,
            "next_delay_minutes": next_delay_minutes,
            "candidate_strength": _candidate_strength(post),
            "rotation_health": {
                "pool_size": int(autopilot.posts_in_rotation or 0),
                "refreshes_last_24h": _refresh_count_last_24h(connected_account_id),
                "last_strategy": getattr(post, "strategy", "") or "Constellation circulation",
                "mix_hint": "Mixed media ready",
                "selection_reason": getattr(post, "reason", "") or growth_metadata.get("last_selection_reason", "balanced weighted pick"),
                "momentum_stack_remaining": _safe_int(growth_metadata.get("momentum_stack_remaining", 0), 0),
                "velocity_stack_active": _boolish(growth_metadata.get("velocity_stack_active", False)),
                "pending_pair_post_id": str(growth_metadata.get("pending_pair_post_id", "") or "").strip(),
            },
        }
    finally:
        db.close()


def _run_analytics_job(connected_account_id: int, payload: dict | None = None) -> dict:
    db = SessionLocal()
    try:
        payload = payload or {}
        return _run_analytics_sync(
            db,
            connected_account_id=connected_account_id,
            source=str(payload.get("source") or "manual"),
            reason=str(payload.get("reason") or "").strip(),
        )
    finally:
        db.close()


def enqueue_due_autopilot_jobs() -> int:
    db = SessionLocal()
    created = 0
    try:
        seed_demo_data(db)
        autopilots = db.query(AutopilotStatus).filter(AutopilotStatus.enabled == True).all()
        now = _utc_now_naive()
        for autopilot in autopilots:
            user = db.query(User).filter(User.id == autopilot.user_id).first()
            if not user:
                continue
            subscription = ensure_user_subscription_state(db, user, stripe_reconcile=True)
            if not subscription.get("can_run_autopilot", False):
                autopilot.enabled = False
                autopilot.next_cycle_at = None
                db.flush()
                continue

            account = db.query(ConnectedAccount).filter(ConnectedAccount.id == autopilot.connected_account_id).first()
            scheduled_at, repaired = _ensure_refresh_schedule_for_account(db, autopilot, account)
            if repaired:
                continue
            if scheduled_at and scheduled_at > now:
                continue
            if find_active_job("refresh", connected_account_id=int(autopilot.connected_account_id)):
                continue
            enqueue_job("refresh", connected_account_id=int(autopilot.connected_account_id), payload={})
            created += 1
        return created
    finally:
        db.close()


def process_pending_jobs(limit: int = 25) -> int:
    processed = 0
    jobs = claim_next_jobs(limit=limit)

    if jobs:
        print(f"[evergreen][jobs] {len(jobs)} queued jobs claimed")

    for job in jobs:
        job_id = job.get("id")
        job_type = str(job.get("job_type", "")).strip()
        account_id = job.get("connected_account_id")

        try:
            print(f"[evergreen][jobs] starting {job_type} job {job_id} (acct={account_id})")

            connected_account_id = int(account_id)
            payload = dict(job.get("payload") or {})

            if job_type == "refresh":
                result = _run_refresh_job(connected_account_id, payload)
            elif job_type == "analytics":
                result = _run_analytics_job(connected_account_id, payload)
            else:
                raise ValueError(f"unsupported job type: {job_type}")

            complete_job(job_id, result)
            print(f"[evergreen][jobs] completed {job_id}")
            processed += 1

        except Exception as exc:
            print(f"[evergreen][jobs] failed {job_id}: {exc}")
            fail_job(job_id, str(exc))

    return processed
