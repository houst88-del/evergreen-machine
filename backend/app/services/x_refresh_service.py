from __future__ import annotations

import json
import os
import random
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import tweepy

from app.core.db import SessionLocal
from app.models.models import ConnectedAccount
from app.services.pool_service import retire_dead_tweet
from app.services.secret_crypto import decrypt_metadata, decrypt_secret


RETWEET_STATE_SETTLE_MIN_SECONDS = 8
RETWEET_STATE_SETTLE_MAX_SECONDS = 14
DELAY_BETWEEN_ACTIONS = 3
RETWEET_RETRY_ATTEMPTS = 5
RETWEET_RETRY_SETTLE_SECONDS = 8

VERIFY_ATTEMPTS = 6
VERIFY_SLEEP_SECONDS = 4


@dataclass
class RefreshResult:
    ok: bool
    message: str
    tweet_id: str | None = None
    did_unretweet: bool = False
    did_retweet: bool = False


def normalize_handle(handle: str | None) -> str:
    raw = str(handle or "").strip()
    return raw.lstrip("@") if raw else "jockulus"


def resolve_client_dir(handle: str | None = None) -> Path:
    return Path.home() / "Applications" / "evergreen-system" / "clients" / normalize_handle(handle)


def config_file(handle: str | None = None) -> Path:
    return resolve_client_dir(handle) / "config.json"


def _load_db_config(handle: str | None = None) -> dict[str, str] | None:
    clean = normalize_handle(handle).lower()
    db = SessionLocal()
    try:
        account = (
            db.query(ConnectedAccount)
            .filter(ConnectedAccount.provider == "x")
            .order_by(ConnectedAccount.updated_at.desc(), ConnectedAccount.id.desc())
            .all()
        )
        match = None
        for row in account:
            row_handle = normalize_handle(getattr(row, "handle", None)).lower()
            if row_handle == clean:
                match = row
                break

        if not match:
            return None

        metadata = decrypt_metadata(getattr(match, "metadata_json", None) or {})
        api_key = str(os.getenv("X_API_KEY", "")).strip() or str(metadata.get("api_key", "") or "").strip()
        api_secret = str(os.getenv("X_API_SECRET", "")).strip() or str(metadata.get("api_secret", "") or "").strip()
        access_token = decrypt_secret(getattr(match, "access_token", None))
        access_token_secret = decrypt_secret(getattr(match, "access_token_secret", None))

        if not access_token:
            access_token = str(metadata.get("access_token", "") or "").strip()
        if not access_token_secret:
            access_token_secret = str(metadata.get("access_token_secret", "") or "").strip()

        config = {
            "api_key": api_key,
            "api_secret": api_secret,
            "access_token": access_token,
            "access_token_secret": access_token_secret,
            "user_id": str(getattr(match, "provider_account_id", "") or "").strip(),
            "handle": str(getattr(match, "handle", "") or "").strip(),
        }

        required = ["api_key", "api_secret", "access_token", "access_token_secret", "user_id"]
        if any(not str(config.get(key, "")).strip() for key in required):
            return None

        return config
    finally:
        db.close()


def load_config(handle: str | None = None) -> tuple[dict, Path]:
    db_config = _load_db_config(handle)
    if db_config:
        return db_config, Path("<db-config>")

    path = config_file(handle)
    if not path.exists():
        raise FileNotFoundError(f"Missing config.json at: {path}")

    with open(path, "r", encoding="utf-8") as f:
        config = json.load(f)

    required = [
        "api_key",
        "api_secret",
        "access_token",
        "access_token_secret",
        "user_id",
    ]
    missing = [k for k in required if not str(config.get(k, "")).strip()]
    if missing:
        raise ValueError(f"Missing config.json fields in {path.name}: {', '.join(missing)}")

    return config, path


def make_client(handle: str | None = None):
    config, path = load_config(handle)

    client = tweepy.Client(
        consumer_key=config["api_key"],
        consumer_secret=config["api_secret"],
        access_token=config["access_token"],
        access_token_secret=config["access_token_secret"],
        wait_on_rate_limit=True,
    )

    return client, config, path


def is_dead_tweet_error(message: str) -> bool:
    lowered = str(message or "").lower()
    signals = [
        "tweet not found",
        "this tweet cannot be found",
        "cannot be found",
        "status not found",
        "status is a duplicate",
        "404",
        "could not find tweet",
        "no status found with that id",
        "user not found",
        "author not found",
        "has been deleted",
    ]
    return any(signal in lowered for signal in signals)


def _retire_dead_tweet(tweet_id: str, handle: str | None = None, raw_error: str = "") -> None:
    handle_slug = normalize_handle(handle)
    retired = retire_dead_tweet(tweet_id=tweet_id, handle=handle, reason="dead_tweet")
    if retired:
        print(f"[evergreen][x-debug] retired dead tweet from pool tweet_id={tweet_id} handle=@{handle_slug}")
    else:
        print(f"[evergreen][x-debug] dead tweet not found in pool, cached anyway tweet_id={tweet_id} handle=@{handle_slug}")
    if raw_error:
        print(f"[evergreen][x-debug] dead tweet reason tweet_id={tweet_id}: {raw_error}")


def _extract_response_data(response: Any) -> list[Any]:
    data = getattr(response, "data", None)
    if data is None:
        return []
    if isinstance(data, list):
        return data
    return [data]


def _is_currently_retweeted(client: tweepy.Client, tweet_id: str, user_id: str) -> bool:
    try:
        response = client.get_retweeters(tweet_id, user_auth=True)
        users = _extract_response_data(response)
        user_ids = {
            str(getattr(user, "id", "") or "")
            for user in users
            if getattr(user, "id", None) is not None
        }
        is_retweeted = user_id in user_ids
        print(
            f"[evergreen][x-debug] verify_retweeted tweet_id={tweet_id} "
            f"user_id={user_id} result={is_retweeted}"
        )
        return is_retweeted
    except Exception as exc:
        print(f"[evergreen][x-debug] verify_retweeted_failed tweet_id={tweet_id} error={exc}")
        return False


def _verify_final_retweeted_state(client: tweepy.Client, tweet_id: str, user_id: str) -> bool:
    for attempt in range(1, VERIFY_ATTEMPTS + 1):
        ok = _is_currently_retweeted(client, tweet_id, user_id)
        if ok:
            print(f"[evergreen][x-debug] final_verify_success tweet_id={tweet_id} attempt={attempt}")
            return True

        if attempt < VERIFY_ATTEMPTS:
            print(
                f"[evergreen][x-debug] final_verify_retry tweet_id={tweet_id} "
                f"attempt={attempt}/{VERIFY_ATTEMPTS} sleep={VERIFY_SLEEP_SECONDS}s"
            )
            time.sleep(VERIFY_SLEEP_SECONDS)

    print(f"[evergreen][x-debug] final_verify_failed tweet_id={tweet_id}")
    return False


def _wait_for_retweet_state_to_clear(tweet_id: str, attempt: int = 1) -> int:
    settle_seconds = random.randint(
        RETWEET_STATE_SETTLE_MIN_SECONDS,
        RETWEET_STATE_SETTLE_MAX_SECONDS,
    )
    extra_seconds = max(0, attempt - 1) * RETWEET_RETRY_SETTLE_SECONDS
    total_seconds = settle_seconds + extra_seconds
    print(
        f"[evergreen][x-debug] waiting {total_seconds}s for retweet state to clear "
        f"(attempt={attempt})"
    )
    time.sleep(total_seconds)
    return total_seconds


def refresh_repost(tweet_id: str, handle: str | None = None) -> RefreshResult:
    tweet_id = str(tweet_id).strip()
    handle_slug = normalize_handle(handle)

    if not tweet_id:
        return RefreshResult(ok=False, message="Missing tweet_id")

    try:
        client, config, cfg_path = make_client(handle)
        user_id = str(config.get("user_id", "")).strip()
        if not user_id:
            raise ValueError("Missing user_id in config.json")

        print(f"[evergreen][x-debug] handle=@{handle_slug}")
        print(f"[evergreen][x-debug] config_path={cfg_path}")
        print(f"[evergreen][x-debug] config_user_id={user_id}")
        print(f"[evergreen][x-debug] api_key_suffix=...{str(config.get('api_key', ''))[-4:]}")
    except Exception as e:
        return RefreshResult(
            ok=False,
            message=f"Auth/config error for @{handle_slug}: {e}",
            tweet_id=tweet_id,
        )

    did_unretweet = False
    did_retweet = False

    try:
        try:
            print(f"[evergreen][x-debug] attempting unretweet source_tweet_id={tweet_id}")
            client.unretweet(source_tweet_id=tweet_id, user_auth=True)
            did_unretweet = True
            print(f"[evergreen][x-debug] unretweet call succeeded source_tweet_id={tweet_id}")
        except Exception as e:
            message = str(e)
            lowered = message.lower()
            print(f"[evergreen][x-debug] unretweet result={message}")

            if is_dead_tweet_error(message):
                _retire_dead_tweet(tweet_id=tweet_id, handle=handle, raw_error=message)
                return RefreshResult(
                    ok=False,
                    message=f"Dead tweet retired for @{handle_slug}: {tweet_id}",
                    tweet_id=tweet_id,
                    did_unretweet=did_unretweet,
                    did_retweet=False,
                )

            if (
                "not retweeted" in lowered
                or "already unretweeted" in lowered
                or "you have not retweeted" in lowered
                or "not found" in lowered
            ):
                print(f"[evergreen][x-debug] tweet {tweet_id} was already clear for refresh")
            else:
                print(f"[evergreen][x-debug] continuing despite unretweet issue")

        time.sleep(DELAY_BETWEEN_ACTIONS)

        retweet_sync_delay = False
        for retweet_attempt in range(1, RETWEET_RETRY_ATTEMPTS + 1):
            _wait_for_retweet_state_to_clear(tweet_id, retweet_attempt)

            try:
                print(
                    f"[evergreen][x-debug] attempting retweet tweet_id={tweet_id} "
                    f"attempt={retweet_attempt}/{RETWEET_RETRY_ATTEMPTS}"
                )
                client.retweet(tweet_id=tweet_id, user_auth=True)
                did_retweet = True
                retweet_sync_delay = False
                print(
                    f"[evergreen][x-debug] retweet call succeeded tweet_id={tweet_id} "
                    f"attempt={retweet_attempt}"
                )
                break
            except Exception as e:
                message = str(e)
                lowered = message.lower()
                print(f"[evergreen][x-debug] retweet result={message}")

                if is_dead_tweet_error(message):
                    _retire_dead_tweet(tweet_id=tweet_id, handle=handle, raw_error=message)
                    return RefreshResult(
                        ok=False,
                        message=f"Dead tweet retired for @{handle_slug}: {tweet_id}",
                        tweet_id=tweet_id,
                        did_unretweet=did_unretweet,
                        did_retweet=False,
                    )

                if (
                    "already retweeted" in lowered
                    or "cannot retweet a tweet that you have already retweeted" in lowered
                ):
                    retweet_sync_delay = True
                    print(
                        f"[evergreen][x-debug] retweet_sync_delay tweet_id={tweet_id} "
                        f"attempt={retweet_attempt}/{RETWEET_RETRY_ATTEMPTS}"
                    )
                    if retweet_attempt < RETWEET_RETRY_ATTEMPTS:
                        continue
                    return RefreshResult(
                        ok=False,
                        message=(
                            f"State sync delay for @{handle_slug} on {tweet_id} — "
                            f"X still thinks it is retweeted after {RETWEET_RETRY_ATTEMPTS} attempts"
                        ),
                        tweet_id=tweet_id,
                        did_unretweet=did_unretweet,
                        did_retweet=did_retweet,
                    )

                raise

        if not did_retweet and retweet_sync_delay:
            return RefreshResult(
                ok=False,
                message=(
                    f"State sync delay for @{handle_slug} on {tweet_id} — "
                    f"retweet verification never cleared"
                ),
                tweet_id=tweet_id,
                did_unretweet=did_unretweet,
                did_retweet=did_retweet,
            )

        if not _verify_final_retweeted_state(client, tweet_id, user_id):
            return RefreshResult(
                ok=False,
                message=f"Retweet write call succeeded but final X state did not verify for @{handle_slug}: {tweet_id}",
                tweet_id=tweet_id,
                did_unretweet=did_unretweet,
                did_retweet=did_retweet,
            )

        return RefreshResult(
            ok=True,
            message="Unretweeted and refreshed repost successfully" if did_unretweet else "Retweeted successfully",
            tweet_id=tweet_id,
            did_unretweet=did_unretweet,
            did_retweet=did_retweet,
        )

    except tweepy.TweepyException as e:
        print(f"[evergreen][x-debug] tweepy_exception_type={type(e).__name__}")
        print(f"[evergreen][x-debug] tweepy_exception={e}")
        if is_dead_tweet_error(str(e)):
            _retire_dead_tweet(tweet_id=tweet_id, handle=handle, raw_error=str(e))
            return RefreshResult(
                ok=False,
                message=f"Dead tweet retired for @{handle_slug}: {tweet_id}",
                tweet_id=tweet_id,
                did_unretweet=did_unretweet,
                did_retweet=did_retweet,
            )
        return RefreshResult(
            ok=False,
            message=f"Tweepy error for @{handle_slug}: {e}",
            tweet_id=tweet_id,
            did_unretweet=did_unretweet,
            did_retweet=did_retweet,
        )
    except Exception as e:
        print(f"[evergreen][x-debug] generic_exception_type={type(e).__name__}")
        print(f"[evergreen][x-debug] generic_exception={e}")
        if is_dead_tweet_error(str(e)):
            _retire_dead_tweet(tweet_id=tweet_id, handle=handle, raw_error=str(e))
            return RefreshResult(
                ok=False,
                message=f"Dead tweet retired for @{handle_slug}: {tweet_id}",
                tweet_id=tweet_id,
                did_unretweet=did_unretweet,
                did_retweet=did_retweet,
            )
        return RefreshResult(
            ok=False,
            message=f"Refresh repost failed for @{handle_slug}: {e}",
            tweet_id=tweet_id,
            did_unretweet=did_unretweet,
            did_retweet=did_retweet,
        )
