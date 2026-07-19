import os
import unittest
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

from app.services.bluesky_import_service import (  # noqa: E402
    _feed_item_ineligible_reason,
    _score_post,
)
from app.services.scoring import _bluesky_post_is_original  # noqa: E402


def ns(**kwargs):
    return SimpleNamespace(**kwargs)


def feed_item(
    *,
    reply=None,
    feed_reply=None,
    reason=None,
    author_did="did:plc:me",
    author_handle="me.bsky.social",
    embed=None,
    like_count=0,
    repost_count=0,
    reply_count=0,
    quote_count=0,
):
    record = ns(text="hello", reply=reply)
    post = ns(
        record=record,
        uri="at://did:plc:me/app.bsky.feed.post/abc",
        author=ns(did=author_did, handle=author_handle),
        embed=embed,
        like_count=like_count,
        repost_count=repost_count,
        reply_count=reply_count,
        quote_count=quote_count,
    )
    return ns(post=post, reply=feed_reply, reason=reason)


class BlueskySafetyTests(unittest.TestCase):
    def setUp(self):
        self.account = ns(
            provider_account_id="did:plc:me",
            handle="me.bsky.social",
        )

    def test_import_filter_rejects_record_replies(self):
        item = feed_item(reply=ns(parent=ns(uri="at://parent")))

        self.assertEqual(_feed_item_ineligible_reason(item, self.account, self.account.handle), "reply")

    def test_import_filter_rejects_feed_replies(self):
        item = feed_item(feed_reply=ns(parent=ns(uri="at://parent")))

        self.assertEqual(_feed_item_ineligible_reason(item, self.account, self.account.handle), "reply")

    def test_import_filter_rejects_reposts_and_other_authors(self):
        repost = feed_item(reason=ns(by="me"))
        other_author = feed_item(author_did="did:plc:someoneelse", author_handle="other.bsky.social")

        self.assertEqual(_feed_item_ineligible_reason(repost, self.account, self.account.handle), "repost")
        self.assertEqual(_feed_item_ineligible_reason(other_author, self.account, self.account.handle), "not_author")

    def test_import_filter_accepts_original_author_posts(self):
        item = feed_item()

        self.assertEqual(_feed_item_ineligible_reason(item, self.account, self.account.handle), "")

    def test_score_uses_replies_quotes_and_video_boost(self):
        item = feed_item(
            embed=ns(py_type="app.bsky.embed.video#view"),
            like_count=2,
            repost_count=1,
            reply_count=3,
            quote_count=1,
        )

        self.assertEqual(_score_post(item), 110)

    def test_selector_rejects_reply_like_legacy_rows(self):
        legacy_reply = ns(
            provider_post_id="at://did:plc:me/app.bsky.feed.post/abc",
            text="@someone agreed, this is wild",
        )

        self.assertFalse(_bluesky_post_is_original(legacy_reply))


if __name__ == "__main__":
    unittest.main()
