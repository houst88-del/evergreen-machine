from fastapi import APIRouter
from app.services.event_stream import get_events

router = APIRouter()

@router.get("/api/events")
def events():
    return {
        "events": get_events()
    }
