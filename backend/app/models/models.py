from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    handle: Mapped[str] = mapped_column(String(100), default="@creator")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    autopilot_statuses: Mapped[list["AutopilotStatus"]] = relationship(back_populates="user")
    connected_accounts: Mapped[list["ConnectedAccount"]] = relationship(back_populates="user")
    posts: Mapped[list["Post"]] = relationship(back_populates="user")


class ConnectedAccount(Base):
    __tablename__ = "connected_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)

    provider: Mapped[str] = mapped_column(String(50))
    provider_account_id: Mapped[str] = mapped_column(String(255))
    handle: Mapped[str] = mapped_column(String(100))

    access_token: Mapped[str] = mapped_column(Text)
    access_token_secret: Mapped[str | None] = mapped_column(Text, nullable=True)

    refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    connection_status: Mapped[str] = mapped_column(String(50), default="connected")
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    user: Mapped["User"] = relationship(back_populates="connected_accounts")
    autopilot_statuses: Mapped[list["AutopilotStatus"]] = relationship(back_populates="connected_account")
    posts: Mapped[list["Post"]] = relationship(back_populates="connected_account")
    job_queue_items: Mapped[list["JobQueueItem"]] = relationship(back_populates="connected_account")


class AutopilotStatus(Base):
    __tablename__ = "autopilot_status"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)

    connected_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("connected_accounts.id"),
        nullable=True,
        index=True,
    )

    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    connected: Mapped[bool] = mapped_column(Boolean, default=False)
    provider: Mapped[str] = mapped_column(String(50), default="x")
    posts_in_rotation: Mapped[int] = mapped_column(Integer, default=0)
    last_post_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_action_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    next_cycle_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    user: Mapped["User"] = relationship(back_populates="autopilot_statuses")
    connected_account: Mapped["ConnectedAccount | None"] = relationship(back_populates="autopilot_statuses")


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)

    connected_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("connected_accounts.id"),
        nullable=True,
        index=True,
    )

    provider_post_id: Mapped[str] = mapped_column(String(100))
    text: Mapped[str] = mapped_column(Text)
    score: Mapped[int] = mapped_column(Integer, default=50)
    state: Mapped[str] = mapped_column(String(50), default="active")
    last_resurfaced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="posts")
    connected_account: Mapped["ConnectedAccount | None"] = relationship(back_populates="posts")


class JobQueueItem(Base):
    __tablename__ = "job_queue_items"

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    connected_account_id: Mapped[int] = mapped_column(
        ForeignKey("connected_accounts.id"),
        index=True,
    )

    job_type: Mapped[str] = mapped_column(String(100), index=True)
    payload_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    status: Mapped[str] = mapped_column(String(50), default="queued", index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    result_json: Mapped[dict | list | str | int | float | bool | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    worker_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    connected_account: Mapped["ConnectedAccount"] = relationship(back_populates="job_queue_items")
