from __future__ import annotations

import json
from datetime import datetime, UTC
from pathlib import Path


def auth_store_dir() -> Path:
    return Path.home() / "Applications" / "evergreen-system" / "platform"


def auth_store_file() -> Path:
    return auth_store_dir() / "auth_users.json"


def ensure_auth_store() -> None:
    path = auth_store_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text("[]", encoding="utf-8")


def load_auth_users() -> list[dict]:
    ensure_auth_store()
    path = auth_store_file()
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []


def save_auth_users(users: list[dict]) -> None:
    ensure_auth_store()
    auth_store_file().write_text(json.dumps(users, indent=2), encoding="utf-8")


def get_auth_user_by_email(email: str) -> dict | None:
    email = str(email).strip().lower()
    for user in load_auth_users():
        if str(user.get("email", "")).strip().lower() == email:
            return user
    return None


def create_auth_user(email: str, handle: str, password_hash: str) -> dict:
    email = str(email).strip().lower()
    handle = str(handle).strip()
    users = load_auth_users()

    existing = [u for u in users if str(u.get("email", "")).strip().lower() == email]
    if existing:
        return existing[0]

    now = datetime.now(UTC).replace(tzinfo=None).isoformat(timespec="seconds")
    user = {
        "email": email,
        "handle": handle,
        "password_hash": password_hash,
        "created_at": now,
        "subscription_status": "inactive",
    }
    users.append(user)
    save_auth_users(users)
    return user


def update_last_login(email: str) -> None:
    email = str(email).strip().lower()
    users = load_auth_users()
    changed = False
    now = datetime.now(UTC).replace(tzinfo=None).isoformat(timespec="seconds")
    for user in users:
        if str(user.get("email", "")).strip().lower() == email:
            user["last_login_at"] = now
            changed = True
            break
    if changed:
        save_auth_users(users)
