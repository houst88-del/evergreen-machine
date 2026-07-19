import os
import unittest

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

from app.core.db import Base, SessionLocal, engine  # noqa: E402
from app.models.models import ConnectedAccount, Post, User  # noqa: E402
from app.routes.galaxy import _select_galaxy_posts  # noqa: E402


class GalaxySamplingTests(unittest.TestCase):
    def setUp(self):
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        self.db = SessionLocal()

        user = User(id=1, email="starden@example.com", handle="@jockulus")
        x_account = ConnectedAccount(
            id=10,
            user_id=1,
            provider="x",
            provider_account_id="x-1",
            handle="@jockulus",
            access_token="token",
        )
        bluesky_account = ConnectedAccount(
            id=20,
            user_id=1,
            provider="bluesky",
            provider_account_id="bsky-1",
            handle="jockulus.bsky.social",
            access_token="token",
        )
        self.db.add_all([user, x_account, bluesky_account])

        for index in range(90):
            self.db.add(
                Post(
                    user_id=1,
                    connected_account_id=10,
                    provider_post_id=f"x-{index}",
                    text=f"X post {index}",
                    score=1000 - index,
                    state="active",
                )
            )

        for index in range(30):
            self.db.add(
                Post(
                    user_id=1,
                    connected_account_id=20,
                    provider_post_id=f"bsky-{index}",
                    text=f"Bluesky post {index}",
                    score=100 - index,
                    state="active",
                )
            )

        self.db.add(
            Post(
                user_id=1,
                connected_account_id=20,
                provider_post_id="retired-high-score",
                text="Retired post",
                score=5000,
                state="retired",
            )
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(bind=engine)

    def test_embedded_unified_sampling_balances_accounts_and_skips_retired(self):
        posts = _select_galaxy_posts(
            self.db,
            account_ids=[10, 20],
            effective_limit=40,
            embedded_view=True,
            unified=True,
        )

        account_ids = [post.connected_account_id for post in posts]
        provider_post_ids = {post.provider_post_id for post in posts}

        self.assertEqual(len(posts), 40)
        self.assertEqual(account_ids.count(10), 20)
        self.assertEqual(account_ids.count(20), 20)
        self.assertNotIn("retired-high-score", provider_post_ids)


if __name__ == "__main__":
    unittest.main()
