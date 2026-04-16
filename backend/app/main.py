from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.db import Base, engine

# Import your models so SQLAlchemy knows about them before create_all runs
# Keep / expand these imports to match your project
from app.models import user  # noqa: F401
from app.models import connected_account  # noqa: F401
from app.models import post  # noqa: F401
from app.models import resurfacing_event  # noqa: F401

# Keep your existing router imports here
# Example:
# from app.api.routes import auth, posts, providers, galaxy, autopilot


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="Evergreen API",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten later for production if you want
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check():
    return {"ok": True}


# Keep your existing router includes here
# Example:
# app.include_router(auth.router, prefix="/api")
# app.include_router(posts.router, prefix="/api")
# app.include_router(providers.router, prefix="/api")
# app.include_router(galaxy.router, prefix="/api")
# app.include_router(autopilot.router, prefix="/api")
