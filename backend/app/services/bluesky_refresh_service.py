from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, UTC
from typing import Any

from atproto import Client
from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.models.models import ConnectedAccount
from app.services.secret_crypto import get_secret_from_metadata


VERIFY_ATTEMPTS = 5
VERIFY_SLEEP_SECONDS = 2


@dataclass
class RefreshResult:
    ok: bool
    message: str


def _utc_now_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _find_bluesky_account_by_handle(db: Session, handle: str) -> ConnectedAccount | None:
    rows = (
        db.query(ConnectedAccount)
        .filter(
            ConnectedAccount.provider == "bluesky",
            ConnectedAccount.handle == handle,
            ConnectedAccount.connection_status == "connected",
        )
        .order_by(ConnectedAccount.id.desc())
        .all()
    )

    if not rows:
        return None

    def has_password(account: ConnectedAccount) -> bool:
        metadata = account.metadata_json or {}
        return bool(get_secret_from_metadata(metadata, "app_password"))

    for row in rows:
        if has_password(row):
            return row

    return rows[0]


def _get_app_password(account: ConnectedAccount) -> str:
    metadata = account.metadata_json or {}
    app_password = get_secret_from_metadata(metadata, "app_password")
    if not app_password:
        raise ValueError(
            "Bluesky app password is missing. Reconnect Bluesky, then try again."
        )
    return app_password


def _get_client_for_account(account: ConnectedAccount) -> Client:
    client = Client()
    client.login(account.handle, _get_app_password(account))
    return client


def _get_post_view(client: Client, post_uri: str):
    response = client.app.bsky.feed.get_posts({"uris": [post_uri]})
    posts = list(getattr(response, "posts", []) or [])
    if not posts:
        raise ValueError(f"Bluesky post not found for uri: {post_uri}")
    return posts[0]


def _get_repost_map(account: ConnectedAccount) -> dict[str, dict[str, Any]]:
    metadata = dict(account.metadata_json or {})
    repost_records = metadata.get("repost_records")
    if not isinstance(repost_records, dict):
        repost_records = {}
    return repost_records


def _save_repost_map(account: ConnectedAccount, repost_records: dict[str, dict[str, Any]]) -> None:
    metadata = dict(account.metadata_json or {})
    metadata["repost_records"] = repost_records
    account.metadata_json = metadata


def _extract_viewer_repost_uri(post_view) -> str:
    viewer = getattr(post_view, "viewer", None)
    repost_uri = getattr(viewer, "repost", None) if viewer is not None else None
    return str(repost_uri or "").strip()


def _verify_final_repost_state(client: Client, provider_post_id: str) -> tuple[bool, str]:
    for attempt in range(1, VERIFY_ATTEMPTS + 1):
        try:
            post_view = _get_post_view(client, provider_post_id)
            repost_uri = _extract_viewer_repost_uri(post_view)
            print(
                f"[evergreen][bluesky-debug] verify_repost uri={provider_post_id} "
                f"attempt={attempt} result={bool(repost_uri)}"
            )
            if repost_uri:
                return True, repost_uri
        except Exception as exc:
            print(
                f"[evergreen][bluesky-debug] verify_repost_failed uri={provider_post_id} "
                f"attempt={attempt} error={exc}"
            )

        if attempt < VERIFY_ATTEMPTS:
            time.sleep(VERIFY_SLEEP_SECONDS)

    return False, ""


def refresh_repost(provider_post_id: str, handle: str) -> RefreshResult:
    db = SessionLocal()
    try:
        account = _find_bluesky_account_by_handle(db, handle)
        if not account:
            return RefreshResult(False, f"Bluesky account not found for handle: {handle}")

        client = _get_client_for_account(account)
        repost_records = _get_repost_map(account)

        existing = repost_records.get(provider_post_id) or {}
        existing_repost_uri = str(existing.get("repost_uri", "") or "").strip()

        if existing_repost_uri:
            try:
                client.com.atproto.repo.delete_record(
                    {
                        "repo": account.provider_account_id,
                        "collection": "app.bsky.feed.repost",
                        "rkey": existing_repost_uri.split("/")[-1],
                    }
                )
            except Exception:
                pass

        post_view = _get_post_view(client, provider_post_id)
        cid = str(getattr(post_view, "cid", "") or "").strip()
        if not cid:
            return RefreshResult(False, f"Missing CID for Bluesky post: {provider_post_id}")

        record = {
            "$type": "app.bsky.feed.repost",
            "subject": {"uri": provider_post_id, "cid": cid},
            "createdAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        }
        response = client.com.atproto.repo.create_record(
            {
                "repo": account.provider_account_id,
                "collection": "app.bsky.feed.repost",
                "record": record,
            }
        )
        repost_uri = str(getattr(response, "uri", "") or "").strip()

        ok, verified_repost_uri = _verify_final_repost_state(client, provider_post_id)
        if not ok:
            return RefreshResult(False, f"Bluesky repost did not verify for {provider_post_id}")

        repost_records[provider_post_id] = {
            "repost_uri": verified_repost_uri or repost_uri,
            "reposted_at": _utc_now_naive().isoformat(),
        }
        _save_repost_map(account, repost_records)
        db.commit()

        return RefreshResult(True, f"Bluesky unreposted/reposted {provider_post_id}")
    except Exception as exc:
        db.rollback()
        return RefreshResult(False, f"Bluesky refresh failed: {exc}")
    finally:
        db.close()
