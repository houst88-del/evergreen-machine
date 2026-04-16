from pathlib import Path

BASE_CLIENT_DIR = Path.home() / "Applications" / "evergreen-system" / "clients"


def get_client_dir(handle: str) -> Path:
    """
    Returns the folder containing a creator's Evergreen data.
    """
    return BASE_CLIENT_DIR / handle


def get_pool_file(handle: str) -> Path:
    return get_client_dir(handle) / "tweet_refresh_pool.csv"


def get_results_file(handle: str) -> Path:
    return get_client_dir(handle) / "tweet_results.csv"
