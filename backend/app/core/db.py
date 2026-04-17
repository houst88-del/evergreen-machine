import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

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
