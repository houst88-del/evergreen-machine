import os
import unittest
from datetime import datetime

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

from app.services.engagement_scoring import evergreen_momentum_bonus  # noqa: E402
from app.services.x_import_service import _score_from_metrics  # noqa: E402


class EngagementScoringTests(unittest.TestCase):
    def test_bonus_is_zero_without_created_at(self):
        metrics = {"like_count": 20, "retweet_count": 4, "reply_count": 2, "quote_count": 1}

        self.assertEqual(evergreen_momentum_bonus(metrics, created_at=None), 0)

    def test_bonus_is_bounded_for_fast_posts(self):
        metrics = {"like_count": 900, "retweet_count": 240, "reply_count": 80, "quote_count": 40}

        self.assertEqual(
            evergreen_momentum_bonus(
                metrics,
                created_at=datetime(2026, 7, 19, 10, 0, 0),
                now=datetime(2026, 7, 19, 12, 0, 0),
            ),
            90,
        )

    def test_x_score_uses_momentum_when_created_at_is_available(self):
        metrics = {
            "like_count": 120,
            "retweet_count": 20,
            "reply_count": 12,
            "quote_count": 8,
            "bookmark_count": 0,
            "impression_count": 0,
        }

        self.assertEqual(
            _score_from_metrics(
                metrics,
                created_at=datetime(2026, 7, 17, 12, 0, 0),
                now=datetime(2026, 7, 19, 12, 0, 0),
            ),
            568,
        )


if __name__ == "__main__":
    unittest.main()
