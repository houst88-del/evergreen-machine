
from app.services.provider_accounts_service import get_provider_account

def load_credentials_for_user(user_id: int):
    account = get_provider_account(user_id, provider="x")
    if not account:
        raise Exception("No connected X account for this user")

    return {
        "access_token": account.access_token,
        "handle": account.handle,
        "provider_account_id": account.provider_account_id,
    }
