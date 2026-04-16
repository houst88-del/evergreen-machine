from __future__ import annotations

from dataclasses import dataclass


@dataclass
class PublishResult:
    ok: bool
    provider_post_id: str
    message: str


class XAdapter:
    """Stub adapter.

    Replace these methods with real OAuth token handling and official X API calls.
    """

    def publish_resurface(self, text: str) -> PublishResult:
        return PublishResult(ok=True, provider_post_id="x-live-placeholder", message=f"Mock published to X: {text}")


class BlueskyAdapter:
    def publish_resurface(self, text: str) -> PublishResult:
        return PublishResult(ok=True, provider_post_id="bsky-live-placeholder", message=f"Mock published to Bluesky: {text}")
