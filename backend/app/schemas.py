from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class StatusResponse(BaseModel):
    running: bool
    connected: bool
    provider: str
    account_handle: str
    posts_in_rotation: int
    last_post_text: Optional[str] = None
    last_action_at: Optional[datetime] = None
    next_cycle_at: Optional[datetime] = None


class ToggleAutopilotRequest(BaseModel):
    enabled: bool


class ConnectProviderRequest(BaseModel):
    provider: str = "x"
