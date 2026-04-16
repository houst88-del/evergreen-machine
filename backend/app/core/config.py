from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Evergreen API"
    app_env: str = "development"
    database_url: str = "sqlite:///./evergreen.db"
    frontend_origin: str = "http://localhost:3000"
    worker_poll_seconds: int = 10
    x_client_id: str = ""
    x_client_secret: str = ""
    x_redirect_uri: str = "http://localhost:8000/api/providers/x/callback"
    bluesky_app_password: str = ""
    encryption_key: str = "replace-me"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
