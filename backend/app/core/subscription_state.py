from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from typing import Any

import stripe

from app.core.auth_store import PAID_SUBSCRIPTION_STATUSES, TRIAL_HOURS, get_auth_user_by_email
from app.models.models import User


stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "").strip()

STRIPE_ACTIVE_STATUSES = {"active", "trialing", "past_due"}
STRIPE_RECONCILE_MINUTES = max(5, int(os.getenv("EVERGREEN_STRIPE_RECONCILE_MINUTES", "15")))


def utc_now_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)

    raw = str(value or "").strip()
    if not raw:
        return None

    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def iso_from_unix_timestamp(value: object) -> datetime | None:
    try:
        ts = int(value or 0)
    except Exception:
        return None
    if ts <= 0:
        return None
    return datetime.fromtimestamp(ts, UTC).replace(tzinfo=None)


def subscription_snapshot_from_values(
    *,
    status: str | None,
    trial_started_at: datetime | str | None,
    trial_ends_at: datetime | str | None,
) -> dict:
    normalized_status = str(status or "").strip().lower()
    started_at = parse_datetime(trial_started_at)
    ends_at = parse_datetime(trial_ends_at)

    if normalized_status in PAID_SUBSCRIPTION_STATUSES:
        return {
            "subscription_status": "active",
            "trial_started_at": started_at.isoformat() if started_at else None,
            "trial_ends_at": ends_at.isoformat() if ends_at else None,
            "can_run_autopilot": True,
        }

    if ends_at and ends_at > utc_now_naive():
        return {
            "subscription_status": "trialing",
            "trial_started_at": started_at.isoformat() if started_at else None,
            "trial_ends_at": ends_at.isoformat() if ends_at else None,
            "can_run_autopilot": True,
        }

    if ends_at:
        return {
            "subscription_status": "expired",
            "trial_started_at": started_at.isoformat() if started_at else None,
            "trial_ends_at": ends_at.isoformat() if ends_at else None,
            "can_run_autopilot": False,
        }

    return {
        "subscription_status": "inactive",
        "trial_started_at": started_at.isoformat() if started_at else None,
        "trial_ends_at": ends_at.isoformat() if ends_at else None,
        "can_run_autopilot": False,
    }


def _apply_trial_defaults(user: User) -> bool:
    raw_status = str(user.subscription_status or "").strip().lower()
    if raw_status in PAID_SUBSCRIPTION_STATUSES:
        return False
    if user.trial_ends_at:
        if not raw_status:
            user.subscription_status = "trialing"
            user.subscription_updated_at = utc_now_naive()
            return True
        return False

    started_at = parse_datetime(user.trial_started_at) or utc_now_naive()
    user.trial_started_at = started_at
    user.trial_ends_at = started_at + timedelta(hours=TRIAL_HOURS)
    if raw_status in {"", "inactive", "trial", "trialing"}:
        user.subscription_status = "trialing"
    user.subscription_updated_at = utc_now_naive()
    return True


def _backfill_from_auth_store(user: User) -> bool:
    auth_user = get_auth_user_by_email(str(user.email or "").strip().lower())
    if not auth_user:
        return False

    changed = False
    auth_status = str(auth_user.get("subscription_status") or "").strip().lower()
    auth_trial_started_at = parse_datetime(auth_user.get("trial_started_at"))
    auth_trial_ends_at = parse_datetime(auth_user.get("trial_ends_at"))
    auth_period_end = parse_datetime(auth_user.get("current_period_end"))

    if auth_status in PAID_SUBSCRIPTION_STATUSES and str(user.subscription_status or "").strip().lower() not in PAID_SUBSCRIPTION_STATUSES:
        user.subscription_status = "active"
        changed = True

    if user.trial_started_at is None and auth_trial_started_at is not None:
        user.trial_started_at = auth_trial_started_at
        changed = True

    if user.trial_ends_at is None and auth_trial_ends_at is not None:
        user.trial_ends_at = auth_trial_ends_at
        changed = True

    if not user.stripe_customer_id and auth_user.get("stripe_customer_id"):
        user.stripe_customer_id = str(auth_user.get("stripe_customer_id") or "").strip() or None
        changed = True

    if not user.stripe_subscription_id and auth_user.get("stripe_subscription_id"):
        user.stripe_subscription_id = str(auth_user.get("stripe_subscription_id") or "").strip() or None
        changed = True

    if not user.stripe_price_id and auth_user.get("stripe_price_id"):
        user.stripe_price_id = str(auth_user.get("stripe_price_id") or "").strip() or None
        changed = True

    if user.current_period_end is None and auth_period_end is not None:
        user.current_period_end = auth_period_end
        changed = True

    if changed:
        user.subscription_updated_at = utc_now_naive()

    return changed


def update_user_subscription(
    user: User,
    *,
    status: str,
    stripe_customer_id: str | None = None,
    stripe_subscription_id: str | None = None,
    stripe_price_id: str | None = None,
    current_period_end: datetime | str | None = None,
) -> None:
    normalized_status = str(status or "").strip().lower() or "inactive"
    user.subscription_status = "active" if normalized_status in PAID_SUBSCRIPTION_STATUSES else normalized_status
    if stripe_customer_id:
        user.stripe_customer_id = stripe_customer_id
    if stripe_subscription_id:
        user.stripe_subscription_id = stripe_subscription_id
    if stripe_price_id:
        user.stripe_price_id = stripe_price_id
    if current_period_end is not None:
        user.current_period_end = parse_datetime(current_period_end)
    user.subscription_updated_at = utc_now_naive()


def _maybe_reconcile_from_stripe(user: User) -> bool:
    if not stripe.api_key:
        return False

    updated_at = parse_datetime(user.subscription_updated_at)
    if updated_at and updated_at >= utc_now_naive() - timedelta(minutes=STRIPE_RECONCILE_MINUTES):
        return False

    email = str(user.email or "").strip().lower()
    if not email:
        return False

    try:
        customers = list((stripe.Customer.list(email=email, limit=10) or {}).get("data") or [])
    except Exception:
        customers = []

    active_subscription: dict | None = None
    latest_subscription: dict | None = None
    latest_customer_id: str | None = None

    for customer in customers:
        customer_id = str(getattr(customer, "id", "") or customer.get("id") or "").strip()
        if not customer_id:
            continue
        try:
            subscriptions = list((stripe.Subscription.list(customer=customer_id, status="all", limit=10) or {}).get("data") or [])
        except Exception:
            continue
        for subscription in subscriptions:
            subscription_created = int(getattr(subscription, "created", 0) or subscription.get("created") or 0)
            if latest_subscription is None or subscription_created > int(
                getattr(latest_subscription, "created", 0) or latest_subscription.get("created") or 0
            ):
                latest_subscription = subscription
                latest_customer_id = customer_id
            sub_status = str(getattr(subscription, "status", "") or subscription.get("status") or "").strip().lower()
            if sub_status in STRIPE_ACTIVE_STATUSES:
                if active_subscription is None or subscription_created > int(
                    getattr(active_subscription, "created", 0) or active_subscription.get("created") or 0
                ):
                    active_subscription = subscription
                    latest_customer_id = customer_id

    subscription = active_subscription or latest_subscription
    if subscription is None:
        return False

    price_id = None
    items = getattr(subscription, "items", None) or subscription.get("items") or {}
    item_rows = getattr(items, "data", None) or items.get("data") or []
    if isinstance(item_rows, list) and item_rows:
        first = item_rows[0]
        price = getattr(first, "price", None) or first.get("price") or {}
        price_id = str(getattr(price, "id", "") or price.get("id") or "").strip() or None

    sub_status = str(getattr(subscription, "status", "") or subscription.get("status") or "").strip().lower()
    update_user_subscription(
        user,
        status="active" if sub_status in STRIPE_ACTIVE_STATUSES else "inactive",
        stripe_customer_id=latest_customer_id,
        stripe_subscription_id=str(getattr(subscription, "id", "") or subscription.get("id") or "").strip() or None,
        stripe_price_id=price_id,
        current_period_end=iso_from_unix_timestamp(
            getattr(subscription, "current_period_end", None) or subscription.get("current_period_end")
        ),
    )
    return True


def ensure_user_subscription_state(db, user: User, *, stripe_reconcile: bool = True) -> dict:
    changed = False

    changed = _backfill_from_auth_store(user) or changed
    changed = _apply_trial_defaults(user) or changed

    snapshot = subscription_snapshot_from_values(
        status=user.subscription_status,
        trial_started_at=user.trial_started_at,
        trial_ends_at=user.trial_ends_at,
    )

    if stripe_reconcile and snapshot.get("subscription_status") != "active":
        if _maybe_reconcile_from_stripe(user):
            changed = True
            snapshot = subscription_snapshot_from_values(
                status=user.subscription_status,
                trial_started_at=user.trial_started_at,
                trial_ends_at=user.trial_ends_at,
            )

    if changed:
        db.add(user)
        db.commit()
        db.refresh(user)

    return snapshot
