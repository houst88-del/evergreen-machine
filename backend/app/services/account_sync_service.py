if provider == "bluesky":
    try:
        result = import_bluesky_posts(
            db,
            user_id=user_id,
            connected_account_id=account.id,
            handle=handle,
            limit=bluesky_limit,
        )
        return {
            "account_id": account.id,
            "provider": provider,
            "handle": handle,
            "ok": True,
            **result,
        }
    except Exception as e:
        msg = str(e)
        if "RateLimitExceeded" in msg or "429" in msg:
            print(f"[evergreen][sync] Bluesky rate limit hit for @{handle}, skipping this cycle")
            return {
                "account_id": account.id,
                "provider": provider,
                "handle": handle,
                "ok": False,
                "skipped": True,
                "error": "Bluesky rate limit exceeded",
            }
        raise
