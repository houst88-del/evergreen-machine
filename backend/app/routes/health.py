from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
def healthcheck():
    return {"ok": True, "service": "evergreen-api"}
