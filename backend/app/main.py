from fastapi import FastAPI
from sqlalchemy import text

from app.core.db import engine
from app.routes import auth, providers, bluesky_routes, x_oauth_routes

app = FastAPI(title="Evergreen Machine")


def run_startup_migrations():
    """
    Lightweight schema patching for SQLite deployments.
    Ensures required columns exist even if the DB was created earlier.
    """
    with engine.begin() as conn:

        # check if column exists
        result = conn.execute(
            text("PRAGMA table_info(connected_accounts)")
        ).fetchall()

        columns = [row[1] for row in result]

        if "access_token_secret" not in columns:
            conn.execute(
                text(
                    """
                    ALTER TABLE connected_accounts
                    ADD COLUMN access_token_secret TEXT
                    """
                )
            )
            print("[evergreen][migration] added access_token_secret column")


@app.on_event("startup")
def startup():
    run_startup_migrations()


# routers
app.include_router(auth.router)
app.include_router(providers.router)
app.include_router(bluesky_routes.router)
app.include_router(x_oauth_routes.router)
