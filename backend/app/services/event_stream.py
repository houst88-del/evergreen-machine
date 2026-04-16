from collections import deque
from datetime import datetime

MAX_EVENTS = 200

_event_buffer = deque(maxlen=MAX_EVENTS)

def emit_event(type, message, meta=None):
    event = {
        "type": type,
        "message": message,
        "meta": meta or {},
        "time": datetime.utcnow().isoformat()
    }

    _event_buffer.appendleft(event)


def get_events(limit=50):
    return list(_event_buffer)[:limit]
