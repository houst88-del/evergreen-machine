from __future__ import annotations

from datetime import datetime, timedelta, UTC
from typing import Any

from fastapi import APIRouter, Header, Query
from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.core.security import verify_token
from app.models.models import AutopilotStatus, ConnectedAccount, Post, User

router = APIRouter(prefix="/api/galaxy", tags=["galaxy"])


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _utc_now_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _normalize_string(value: Any) -> str:
    return str(value or "").strip().lower()


def _account_sort_key(account: ConnectedAccount) -> tuple[int, int]:
    connected = str(getattr(account, "connection_status", "") or "").strip().lower() == "connected"
    return (0 if connected else 1, -int(getattr(account, "id", 0) or 0))


def _preferred_accounts(accounts: list[ConnectedAccount]) -> list[ConnectedAccount]:
    ranked = sorted(accounts, key=_account_sort_key)
    deduped: list[ConnectedAccount] = []
    seen_providers: set[str] = set()

    for account in ranked:
        provider = str(getattr(account, "provider", "") or "").strip().lower()
        if provider in seen_providers:
            continue
        seen_providers.add(provider)
        deduped.append(account)

    return deduped


def _score_percentile_map(values: list[float]) -> dict[float, float]:
    if not values:
        return {}

    ordered = sorted(values)
    total = max(1, len(ordered) - 1)
    percentiles: dict[float, float] = {}

    for index, value in enumerate(ordered):
        percentiles.setdefault(value, index / total if total else 1.0)

    return percentiles


def _is_recent(dt_value, minutes: int) -> bool:
    if not dt_value:
        return False
    try:
        return (_utc_now_naive() - dt_value) <= timedelta(minutes=minutes)
    except Exception:
        return False


def _extract_refresh_count(post: Post) -> int:
    raw = getattr(post, "raw", None)
    if isinstance(raw, dict):
        return _safe_int(raw.get("refresh_count", 0), 0)
    return 0


def _raw_dict(post: Post) -> dict[str, Any]:
    raw = getattr(post, "raw", None)
    return raw if isinstance(raw, dict) else {}


def _raw_value(post: Post, *keys: str, default: Any = None) -> Any:
    raw = _raw_dict(post)
    for key in keys:
        if key in raw and raw.get(key) not in (None, ""):
            return raw.get(key)
    return default


def _extract_label(post: Post, account: ConnectedAccount | None) -> str:
    provider_post_id = str(getattr(post, "provider_post_id", "") or "").strip()
    text = str(getattr(post, "text", "") or "").strip()
    provider = _normalize_string(getattr(account, "provider", None))

    if text and not text.startswith("http") and not text.startswith("at://"):
        return text

    if provider == "bluesky" and provider_post_id.startswith("at://"):
        try:
            parts = provider_post_id.split("/")
            post_id = parts[-1]
            handle = str(getattr(account, "handle", "") or "").strip()
            label_handle = handle or "Bluesky"
            return f"{label_handle} post · {post_id[:8]}"
        except Exception:
            return "Bluesky post"

    if provider_post_id:
        return provider_post_id

    return f"post-{post.id}"


def _extract_url(post: Post, account: ConnectedAccount | None) -> str:
    text = str(getattr(post, "text", "") or "").strip()
    provider_post_id = str(getattr(post, "provider_post_id", "") or "").strip()
    provider = _normalize_string(getattr(account, "provider", None))

    if text.startswith("http://") or text.startswith("https://"):
        return text

    if provider == "x" and provider_post_id:
        handle = str(getattr(account, "handle", "") or "").strip().lstrip("@")
        if handle:
            return f"https://x.com/{handle}/status/{provider_post_id}"

    if provider == "bluesky" and provider_post_id.startswith("at://"):
        try:
            parts = provider_post_id.split("/")
            did = parts[2]
            post_id = parts[-1]
            return f"https://bsky.app/profile/{did}/post/{post_id}"
        except Exception:
            return ""

    return ""


def _infer_archetype(post: Post) -> str:
    text = _normalize_string(getattr(post, "text", None))
    provider_post_id = _normalize_string(getattr(post, "provider_post_id", None))
    haystack = f"{text} {provider_post_id}".strip()

    raw_archetype = _normalize_string(_raw_value(post, "archetype", default=""))
    if raw_archetype:
        return raw_archetype

    if not haystack:
        return "unknown"

    if any(k in haystack for k in ["buy", "sale", "subscribe", "link in bio", "onlyfans", "join"]):
        return "conversion"
    if any(k in haystack for k in ["story", "remember", "when i was", "growing up", "back then"]):
        return "story"
    if any(k in haystack for k in ["tip", "how to", "advice", "guide", "thread", "explained"]):
        return "authority"
    if any(k in haystack for k in ["question", "what do you think", "would you", "poll", "?"]):
        return "conversation"
    if any(k in haystack for k in ["loop", "clip", "video", "photo", "mirror", "selfie", "preview"]):
        return "showcase"

    return "evergreen"


def _revival_score(post: Post, score: float, refresh_count: int) -> float:
    raw_revival = _raw_value(post, "revival_score", default=None)
    if raw_revival is not None:
        return round(_safe_float(raw_revival, 0.0), 2)

    age_bonus = 0.0
    try:
        created_at = getattr(post, "created_at", None)
        if created_at:
            age_days = max(0.0, (_utc_now_naive() - created_at).total_seconds() / 86400.0)
            age_bonus = min(40.0, age_days * 0.08)
    except Exception:
        age_bonus = 0.0

    resurfaced_bonus = min(20.0, refresh_count * 1.25)
    dormant_bonus = 10.0 if not getattr(post, "last_resurfaced_at", None) else 0.0

    return round(score * 0.35 + age_bonus + resurfaced_bonus + dormant_bonus, 2)


def _gravity_tier(post: Post, score: float, percentile: float) -> str:
    raw_tier = _normalize_string(_raw_value(post, "gravity_tier", "gravity", default=""))
    if raw_tier in {"gravity", "strong", "standard"}:
        return raw_tier

    if percentile >= 0.92 or score >= 320:
        return "gravity"
    if percentile >= 0.68 or score >= 160:
        return "strong"
    return "standard"


def _gravity_score(post: Post, score: float) -> float | None:
    raw_score = _raw_value(post, "gravity_score", default=None)
    if raw_score is None:
        return None
    return round(_safe_float(raw_score, score), 3)


def _predicted_velocity(post: Post) -> float | None:
    raw_velocity = _raw_value(post, "predicted_velocity", default=None)
    if raw_velocity is None:
        return None
    return round(_safe_float(raw_velocity, 0.0), 4)


def _archive_signal(post: Post) -> float | None:
    raw_signal = _raw_value(post, "archive_signal", default=None)
    if raw_signal is None:
        return None
    return round(_safe_float(raw_signal, 0.0), 4)


def _pair_partner_id(post: Post) -> str | None:
    raw_partner = _raw_value(post, "pair_partner_id", default=None)
    if raw_partner in (None, ""):
        return None
    return str(raw_partner).strip() or None


def _selection_strategy(post: Post, autopilot: AutopilotStatus | None) -> str | None:
    raw_strategy = _raw_value(post, "selection_strategy", default=None)
    if raw_strategy not in (None, ""):
        return str(raw_strategy).strip()

    if autopilot and isinstance(getattr(autopilot, "metadata_json", None), dict):
        current_id = str(getattr(post, "provider_post_id", "") or "").strip()
        meta = autopilot.metadata_json or {}
        selected_id = str(meta.get("selected_post_id", "") or "").strip()
        if current_id and current_id == selected_id:
            value = str(meta.get("current_selection_strategy", "") or "").strip()
            return value or None

    return None


def _selection_reason(post: Post, autopilot: AutopilotStatus | None) -> str | None:
    raw_reason = _raw_value(post, "selection_reason", default=None)
    if raw_reason not in (None, ""):
        return str(raw_reason).strip()

    if autopilot and isinstance(getattr(autopilot, "metadata_json", None), dict):
        current_id = str(getattr(post, "provider_post_id", "") or "").strip()
        meta = autopilot.metadata_json or {}
        selected_id = str(meta.get("selected_post_id", "") or "").strip()
        if current_id and current_id == selected_id:
            value = str(meta.get("current_selection_reason", "") or "").strip()
            return value or None

    return None


def _is_current_cycle(post: Post, autopilot: AutopilotStatus | None) -> bool:
    if not autopilot:
        return False

    last_post_marker = _normalize_string(getattr(autopilot, "last_post_text", None))
    provider_post_id = _normalize_string(getattr(post, "provider_post_id", None))
    text = _normalize_string(getattr(post, "text", None))

    if last_post_marker and (provider_post_id == last_post_marker or text == last_post_marker):
        return True

    if _is_recent(getattr(post, "last_resurfaced_at", None), 20):
        return True

    if isinstance(getattr(autopilot, "metadata_json", None), dict):
        selected_post_id = _normalize_string(autopilot.metadata_json.get("selected_post_id"))
        if selected_post_id and provider_post_id == selected_post_id:
            return True

    return False


def _candidate_flag(score: float, gravity: str, revival_score: float, percentile: float) -> bool:
    return bool(
        percentile >= 0.78
        or score >= 240
        or revival_score >= 120
        or gravity == "gravity"
    )


def _normalized_handle(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    return raw if raw.startswith("@") else f"@{raw}"


def _migrate_user_records(db: Session, source: User, target: User) -> None:
    if source.id == target.id:
        return

    for account in db.query(ConnectedAccount).filter(ConnectedAccount.user_id == source.id).all():
        account.user_id = target.id

    for post in db.query(Post).filter(Post.user_id == source.id).all():
        post.user_id = target.id

    for autopilot in db.query(AutopilotStatus).filter(AutopilotStatus.user_id == source.id).all():
        autopilot.user_id = target.id

    db.flush()
    db.delete(source)
    db.flush()


def _resolve_requested_user_id(
    db: Session,
    authorization: str | None,
    fallback_user_id: int,
    hinted_email: str | None = None,
    hinted_handle: str | None = None,
) -> int:
    payload = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        payload = verify_token(token)

    token_email = str((payload or {}).get("email", "")).strip().lower()
    token_handle = _normalized_handle((payload or {}).get("handle"))
    candidate_email = str(hinted_email or token_email).strip().lower()
    candidate_handle = _normalized_handle(hinted_handle or token_handle)

    user_by_email = (
        db.query(User).filter(User.email == candidate_email).first()
        if candidate_email
        else None
    )
    if not candidate_handle and user_by_email:
        candidate_handle = _normalized_handle(getattr(user_by_email, "handle", None))
    user_by_handle = (
        db.query(User).filter(User.handle == candidate_handle).order_by(User.id.asc()).first()
        if candidate_handle
        else None
    )

    if user_by_email and user_by_handle and user_by_email.id != user_by_handle.id:
        _migrate_user_records(db, source=user_by_handle, target=user_by_email)
        db.commit()
        db.refresh(user_by_email)
        return int(user_by_email.id)

    if user_by_email:
        return int(user_by_email.id)

    if user_by_handle:
        return int(user_by_handle.id)

    if payload and payload.get("user_id"):
        return int(payload["user_id"])
    return fallback_user_id


def _fetch_accounts_for_mode(
    db: Session,
    user_id: int,
    connected_account_id: int | None,
    unified: bool,
) -> list[ConnectedAccount]:
    if unified:
        accounts = (
            db.query(ConnectedAccount)
            .filter(ConnectedAccount.user_id == user_id)
            .all()
        )
        return sorted(_preferred_accounts(accounts), key=lambda account: str(account.provider or "").lower())

    if connected_account_id is None:
        accounts = (
            db.query(ConnectedAccount)
            .filter(ConnectedAccount.user_id == user_id)
            .all()
        )
        preferred = _preferred_accounts(accounts)
        return [preferred[0]] if preferred else []

    account = (
        db.query(ConnectedAccount)
        .filter(
            ConnectedAccount.id == connected_account_id,
            ConnectedAccount.user_id == user_id,
        )
        .first()
    )
    return [account] if account else []


def _serialize_autopilot_metadata(autopilot: AutopilotStatus | None) -> dict[str, Any]:
    if not autopilot:
        return {}
    metadata = getattr(autopilot, "metadata_json", None)
    return dict(metadata) if isinstance(metadata, dict) else {}


def _aggregate_unified_metadata(
    autopilots: list[AutopilotStatus],
    next_cycle_at: datetime | None,
    last_action_at: datetime | None,
) -> dict[str, Any]:
    if not autopilots:
        return {}

    momentum_remaining = 0
    velocity_stack = 0
    queued_pair = None
    current_selection_strategy = ""
    current_selection_reason = ""
    selected_post_id = ""

    latest_meta_ts = None

    for autopilot in autopilots:
        metadata = _serialize_autopilot_metadata(autopilot)
        momentum_remaining = max(momentum_remaining, _safe_int(metadata.get("momentum_remaining", 0), 0))
        velocity_stack = max(
            velocity_stack,
            _safe_int(metadata.get("velocity_stack_remaining", metadata.get("velocity_stack", 0)), 0),
        )

        if not queued_pair:
            queued_pair = metadata.get("pending_pair_post_id") or metadata.get("queued_pair_post_id")

        marker_ts = getattr(autopilot, "last_action_at", None) or getattr(autopilot, "next_cycle_at", None)
        if latest_meta_ts is None or (marker_ts and marker_ts > latest_meta_ts):
            latest_meta_ts = marker_ts
            current_selection_strategy = str(metadata.get("current_selection_strategy", "") or "").strip()
            current_selection_reason = str(metadata.get("current_selection_reason", "") or "").strip()
            selected_post_id = str(metadata.get("selected_post_id", "") or "").strip()

    return {
        "mode": "unified",
        "momentum_remaining": momentum_remaining,
        "velocity_stack": velocity_stack,
        "pending_pair_post_id": queued_pair,
        "current_selection_strategy": current_selection_strategy,
        "current_selection_reason": current_selection_reason,
        "selected_post_id": selected_post_id,
        "next_cycle_at": next_cycle_at.isoformat() if next_cycle_at else None,
        "last_action_at": last_action_at.isoformat() if last_action_at else None,
    }


@router.get("")
def get_galaxy(
    user_id: int = Query(default=1, ge=1),
    connected_account_id: int | None = Query(default=None),
    unified: bool = Query(default=False),
    limit: int = Query(default=2000, ge=1, le=5000),
    authorization: str | None = Header(default=None),
    x_evergreen_email: str | None = Header(default=None),
    x_evergreen_handle: str | None = Header(default=None),
):
    db: Session = SessionLocal()
    try:
        resolved_user_id = _resolve_requested_user_id(
            db, authorization, user_id, x_evergreen_email, x_evergreen_handle
        )
        accounts = _fetch_accounts_for_mode(db, resolved_user_id, connected_account_id, unified)
        if not accounts:
            return {
                "nodes": [],
                "meta": {
                    "user_id": resolved_user_id,
                    "connected_account_id": connected_account_id,
                    "count": 0,
                    "running": False,
                    "connected": False,
                    "last_action_at": None,
                    "next_cycle_at": None,
                    "mode": "unified" if unified else "single",
                    "metadata": {},
                },
            }

        account_map = {account.id: account for account in accounts if account is not None}
        account_ids = list(account_map.keys())

        query = db.query(Post)
        if account_ids:
            query = query.filter(Post.connected_account_id.in_(account_ids))

        posts = query.order_by(Post.score.desc(), Post.id.asc()).limit(limit).all()
        percentile_map = _score_percentile_map(
            [_safe_float(getattr(post, "score", 0), 0.0) for post in posts]
        )

        autopilots = (
            db.query(AutopilotStatus)
            .filter(AutopilotStatus.connected_account_id.in_(account_ids))
            .all()
            if account_ids
            else []
        )
        autopilot_map = {a.connected_account_id: a for a in autopilots}

        any_running = any(bool(a.enabled) for a in autopilots)
        any_connected = any(bool(a.connected) for a in autopilots)

        last_action_at = None
        next_cycle_at = None

        for ap in autopilots:
            if ap.last_action_at and (last_action_at is None or ap.last_action_at > last_action_at):
                last_action_at = ap.last_action_at
            if ap.next_cycle_at and (next_cycle_at is None or ap.next_cycle_at < next_cycle_at):
                next_cycle_at = ap.next_cycle_at

        nodes: list[dict[str, Any]] = []
        for idx, post in enumerate(posts):
            score = _safe_float(getattr(post, "score", 0), 0.0)
            percentile = percentile_map.get(score, 0.0)
            refresh_count = _extract_refresh_count(post)
            revival_score = _revival_score(post, score, refresh_count)

            account = account_map.get(getattr(post, "connected_account_id", None))
            autopilot = autopilot_map.get(getattr(post, "connected_account_id", None))

            gravity = _gravity_tier(post, score, percentile)
            gravity_score = _gravity_score(post, score)
            predicted_velocity = _predicted_velocity(post)
            archive_signal = _archive_signal(post)

            current_cycle = _is_current_cycle(post, autopilot)
            candidate = _candidate_flag(score, gravity, revival_score, percentile)

            # Visual tiering should create a real spiral, not a flat ring.
            # X and Bluesky scores live on different scales, so we normalize before
            # assigning tiers. This keeps galaxies visually balanced and prevents
            # modest-but-viable evergreen posts from collapsing into debris rails.
            provider_name = _normalize_string(getattr(account, "provider", None))
            is_x = provider_name in {"x", "twitter"}
            is_bluesky = provider_name in {"bluesky", "bsky"}

            age_days = 0.0
            try:
                created_at = getattr(post, "created_at", None)
                if created_at:
                    age_days = max(0.0, (_utc_now_naive() - created_at).total_seconds() / 86400.0)
            except Exception:
                age_days = 0.0

            if is_x:
                cold_archive = bool(
                    percentile < 0.14
                    and score < 120
                    and revival_score < 18
                    and refresh_count == 0
                    and age_days >= 30
                    and not candidate
                    and not current_cycle
                )
                normalized_score = percentile * 100
            elif is_bluesky:
                cold_archive = bool(
                    percentile < 0.18
                    and score < 36
                    and revival_score < 28
                    and refresh_count <= 1
                    and age_days >= 10
                    and not candidate
                    and not current_cycle
                )
                normalized_score = percentile * 100
            else:
                cold_archive = bool(
                    percentile < 0.16
                    and score < 60
                    and revival_score < 22
                    and refresh_count == 0
                    and age_days >= 14
                    and not candidate
                    and not current_cycle
                )
                normalized_score = percentile * 100

            if gravity_score is not None:
                normalized_score += min(24.0, max(0.0, gravity_score) * 0.024)
            if predicted_velocity is not None:
                normalized_score += min(18.0, max(0.0, predicted_velocity) * 8.0)
            normalized_score += min(12.0, revival_score * 0.04)
            if current_cycle and normalized_score < 76:
                normalized_score = 76.0
            elif candidate and normalized_score < 52:
                normalized_score = 52.0

            if normalized_score >= 92 or gravity == "gravity":
                tier = "core"
            elif normalized_score >= 64 or gravity == "strong":
                tier = "inner_arm"
            elif cold_archive:
                tier = "drift"
            else:
                tier = "outer_arm"

            nodes.append(
                {
                    "id": str(getattr(post, "provider_post_id", None) or post.id),
                    "post_id": post.id,
                    "url": _extract_url(post, account),
                    "label": _extract_label(post, account),
                    "score": score,
                    "normalized_score": round(normalized_score, 2),
                    "score_percentile": round(percentile, 4),
                    "gravity": gravity,
                    "tier": tier,
                    "cold_archive": cold_archive,
                    "archetype": _infer_archetype(post),
                    "revival_score": revival_score,
                    "refresh_count": refresh_count,
                    "gravity_score": gravity_score,
                    "predicted_velocity": predicted_velocity,
                    "archive_signal": archive_signal,
                    "pair_partner_id": _pair_partner_id(post),
                    "selection_strategy": _selection_strategy(post, autopilot),
                    "selection_reason": _selection_reason(post, autopilot),
                    "state": getattr(post, "state", "") or "unknown",
                    "connected_account_id": getattr(post, "connected_account_id", None),
                    "provider": getattr(account, "provider", None) or "x",
                    "handle": getattr(account, "handle", None) or "",
                    "x": (idx % 36),
                    "y": (idx // 36),
                    "candidate": candidate,
                    "current_cycle": current_cycle,
                    "last_resurfaced_at": (
                        post.last_resurfaced_at.isoformat()
                        if getattr(post, "last_resurfaced_at", None)
                        else None
                    ),
                }
            )

        if unified:
            metadata = _aggregate_unified_metadata(autopilots, next_cycle_at, last_action_at)
        else:
            selected_autopilot = autopilot_map.get(account_ids[0]) if account_ids else None
            metadata = _serialize_autopilot_metadata(selected_autopilot)

        return {
            "nodes": nodes,
            "meta": {
                "user_id": resolved_user_id,
                "connected_account_id": connected_account_id,
                "count": len(nodes),
                "running": any_running,
                "connected": any_connected,
                "last_action_at": last_action_at.isoformat() if last_action_at else None,
                "next_cycle_at": next_cycle_at.isoformat() if next_cycle_at else None,
                "mode": "unified" if unified else "single",
                "account_count": len(account_ids),
                "metadata": metadata,
            },
        }
    finally:
        db.close()
