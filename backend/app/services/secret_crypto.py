from __future__ import annotations

import base64
import hashlib
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


SECRET_PREFIX = "enc::"
SECURE_METADATA_KEYS = {
    "app_password",
    "api_key",
    "api_secret",
    "access_token",
    "access_token_secret",
    "refresh_token",
}


def _fernet() -> Fernet:
    seed = str(settings.encryption_key or "").strip() or "replace-me"
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def is_encrypted_value(value: Any) -> bool:
    return str(value or "").startswith(SECRET_PREFIX)


def encrypt_secret(value: str | None) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if is_encrypted_value(raw):
        return raw
    token = _fernet().encrypt(raw.encode("utf-8")).decode("utf-8")
    return f"{SECRET_PREFIX}{token}"


def decrypt_secret(value: str | None) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if not is_encrypted_value(raw):
        return raw
    token = raw[len(SECRET_PREFIX):]
    try:
        return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("Stored secret could not be decrypted with current encryption key") from exc


def encrypt_metadata(metadata: dict[str, Any] | None) -> dict[str, Any]:
    normalized = dict(metadata or {})
    for key in SECURE_METADATA_KEYS:
        if key in normalized:
            normalized[key] = encrypt_secret(str(normalized.get(key, "") or ""))
    return normalized


def decrypt_metadata(metadata: dict[str, Any] | None) -> dict[str, Any]:
    normalized = dict(metadata or {})
    for key in SECURE_METADATA_KEYS:
        if key in normalized:
            normalized[key] = decrypt_secret(str(normalized.get(key, "") or ""))
    return normalized


def get_secret_from_metadata(metadata: dict[str, Any] | None, key: str) -> str:
    normalized = dict(metadata or {})
    return decrypt_secret(str(normalized.get(key, "") or ""))


def set_secret_in_metadata(metadata: dict[str, Any] | None, key: str, value: str | None) -> dict[str, Any]:
    normalized = dict(metadata or {})
    normalized[key] = encrypt_secret(value)
    return normalized
