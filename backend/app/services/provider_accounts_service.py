from __future__ import annotations

from typing import Any
from app.core.db import SessionLocal
from app.models.models import ConnectedAccount


def serialize_connected_account(account: ConnectedAccount) -> dict[str, Any]:
    return {
        "id": account.id,
        "user_id": account.user_id,
        "provider": account.provider,
        "provider_account_id": account.provider_account_id,
        "handle": account.handle,
        "connection_status": account.connection_status,
        "metadata_json": account.metadata_json or {},
        "created_at": account.created_at.isoformat() if account.created_at else None,
        "updated_at": account.updated_at.isoformat() if account.updated_at else None,
    }


def get_provider_account(user_id: int, provider: str = "x", handle: str | None = None):
    db = SessionLocal()
    try:
        query = db.query(ConnectedAccount).filter(
            ConnectedAccount.user_id == user_id,
            ConnectedAccount.provider == provider,
            ConnectedAccount.connection_status == "connected",
        )

        if handle:
            query = query.filter(ConnectedAccount.handle == handle)

        return query.order_by(ConnectedAccount.id.desc()).first()

    finally:
        db.close()


def list_provider_accounts(user_id: int, provider: str | None = None):
    db = SessionLocal()

    try:
        query = db.query(ConnectedAccount).filter(
            ConnectedAccount.user_id == user_id
        )

        if provider:
            query = query.filter(ConnectedAccount.provider == provider)

        rows = query.order_by(
            ConnectedAccount.provider.asc(),
            ConnectedAccount.handle.asc()
        ).all()

        return [serialize_connected_account(row) for row in rows]

    finally:
        db.close()


def save_provider_account(
    user_id: int,
    provider: str,
    provider_account_id: str,
    handle: str,
    access_token: str,
    refresh_token: str | None = None,
    token_expires_at=None,
    metadata_json: dict | None = None,
):
    db = SessionLocal()

    try:
        existing = (
            db.query(ConnectedAccount)
            .filter(
                ConnectedAccount.user_id == user_id,
                ConnectedAccount.provider == provider,
                ConnectedAccount.provider_account_id == provider_account_id,
            )
            .first()
        )

        if existing:
            existing.handle = handle
            existing.access_token = access_token
            existing.refresh_token = refresh_token
            existing.token_expires_at = token_expires_at
            existing.connection_status = "connected"
            existing.metadata_json = metadata_json or existing.metadata_json

            db.commit()
            db.refresh(existing)
            return existing

        account = ConnectedAccount(
            user_id=user_id,
            provider=provider,
            provider_account_id=provider_account_id,
            handle=handle,
            access_token=access_token,
            refresh_token=refresh_token,
            token_expires_at=token_expires_at,
            connection_status="connected",
            metadata_json=metadata_json or {},
        )

        db.add(account)
        db.commit()
        db.refresh(account)

        return account

    finally:
        db.close()


def disconnect_provider_account(account_id: int, user_id: int):
    db = SessionLocal()

    try:
        account = (
            db.query(ConnectedAccount)
            .filter(
                ConnectedAccount.id == account_id,
                ConnectedAccount.user_id == user_id,
            )
            .first()
        )

        if not account:
            return None

        account.connection_status = "disconnected"

        db.commit()
        db.refresh(account)

        return serialize_connected_account(account)

    finally:
        db.close()
