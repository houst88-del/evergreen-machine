from sqlalchemy.orm import Session
def _make_client(db: Session, connected_account_id: int):
    account = (
        db.query(ConnectedAccount)
        .filter(ConnectedAccount.id == connected_account_id)
        .first()
    )

    if not account:
        raise RuntimeError(f"Connected account not found: {connected_account_id}")

    access_token = getattr(account, "access_token", None)
    access_token_secret = getattr(account, "access_token_secret", None)

    # IMPORTANT: model uses provider_account_id
    user_id = str(getattr(account, "provider_account_id", "") or "").strip()

    if not access_token:
        raise RuntimeError("Missing OAuth access_token for X account")

    if not user_id:
        raise RuntimeError("Missing provider_account_id for connected account")

    client = tweepy.Client(
        consumer_key=settings.x_api_key,
        consumer_secret=settings.x_api_secret,
        access_token=access_token,
        access_token_secret=access_token_secret,
    )

    return client, user_id
