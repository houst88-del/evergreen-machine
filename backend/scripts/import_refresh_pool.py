import csv
from datetime import datetime

from app.core.db import SessionLocal
from app.models.models import Post

CSV_FILE = "tweet_refresh_pool(2).csv"
CONNECTED_ACCOUNT_ID = 1   # @jockulus


db = SessionLocal()

count = 0
skipped_retired = 0
skipped_dead = 0
skipped_missing_id = 0

with open(CSV_FILE, newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)

    for row in reader:
        tweet_id = str(row.get("tweet_id") or "").strip()
        retired = str(row.get("retired") or "").strip().lower() in {"yes", "true", "1", "y"}
        retired_reason = str(row.get("retired_reason") or "").strip().lower()

        if not tweet_id:
            skipped_missing_id += 1
            continue

        if retired_reason == "dead_tweet":
            skipped_dead += 1
            continue

        if retired:
            skipped_retired += 1
            continue

        post = Post(
            user_id=1,
            connected_account_id=CONNECTED_ACCOUNT_ID,
            provider_post_id=tweet_id,
            text=row.get("text") or "",
            score=float(row.get("score") or 0),
            state="active",
            created_at=datetime.utcnow(),
        )

        db.add(post)
        count += 1

db.commit()

print(
    f"Imported {count} posts "
    f"(skipped dead={skipped_dead}, skipped retired={skipped_retired}, skipped missing_id={skipped_missing_id})"
)
