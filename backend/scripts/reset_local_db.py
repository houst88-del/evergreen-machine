from pathlib import Path

from app.core.db import Base, engine
from app.services.scoring import seed_demo_data
from app.models.models import User
from sqlalchemy.orm import Session
from app.core.db import SessionLocal
from app.core.config import settings

db_url = settings.database_url.replace("sqlite:///", "")
DB_PATH = Path(db_url)


def main():
    if DB_PATH.exists():
        DB_PATH.unlink()
        print(f'Removed {DB_PATH}')
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db: Session = SessionLocal()
    try:
        seed_demo_data(db)
        print('Recreated tables and seeded demo data.')
        print('Now reconnect X / Bluesky and import Bluesky again.')
    finally:
        db.close()


if __name__ == '__main__':
    main()
