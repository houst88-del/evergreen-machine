from app.core.db import SessionLocal
from app.models.models import User, ConnectedAccount, AutopilotStatus, Post


def run():
    db = SessionLocal()

    try:
        users = db.query(User).all()

        for user in users:
            account = (
                db.query(ConnectedAccount)
                .filter(ConnectedAccount.user_id == user.id)
                .first()
            )

            if not account:
                print(f"Skipping user {user.id} — no connected account")
                continue

            autopilot = (
                db.query(AutopilotStatus)
                .filter(AutopilotStatus.user_id == user.id)
                .first()
            )

            if autopilot and not autopilot.connected_account_id:
                autopilot.connected_account_id = account.id
                print(f"Linked autopilot → account {account.id}")

            posts = (
                db.query(Post)
                .filter(Post.user_id == user.id)
                .all()
            )

            for post in posts:
                if not post.connected_account_id:
                    post.connected_account_id = account.id

            print(f"Linked {len(posts)} posts → account {account.id}")

        db.commit()

        print("Backfill complete.")

    finally:
        db.close()


if __name__ == "__main__":
    run()
