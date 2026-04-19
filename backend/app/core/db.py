import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.pool import NullPool

raw_database_url = os.getenv("DATABASE_URL", "").strip()

if not raw_database_url:
    raise RuntimeError("DATABASE_URL environment variable is required")

database_url = raw_database_url

# Supabase / managed Postgres often needs sslmode=require.
if database_url.startswith("postgresql://") and "sslmode=" not in database_url:
    joiner = "&" if "?" in database_url else "?"
    database_url = f"{database_url}{joiner}sslmode=require"

connect_args = {}
engine_kwargs = {
    "pool_pre_ping": True,
    "pool_recycle": 300,
    "future": True,
}

if database_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
else:
    # Managed Postgres poolers such as Supabase session-mode poolers can exhaust
    # quickly when app containers also retain their own SQLAlchemy pool. Prefer
    # opening short-lived connections instead of holding them across requests.
    use_null_pool = any(
        marker in database_url.lower()
        for marker in ("supabase.com", "pooler.supabase.com", "aws-1-us-east-2.pooler.supabase.com")
    ) or os.getenv("EVERGREEN_DB_NULL_POOL", "1").strip().lower() in {"1", "true", "yes", "on"}

    if use_null_pool:
        engine_kwargs["poolclass"] = NullPool
    else:
        engine_kwargs.update(
            {
                "pool_size": 5,
                "max_overflow": 10,
                "pool_timeout": 30,
            }
        )

engine = create_engine(
    database_url,
    connect_args=connect_args,
    **engine_kwargs,
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
