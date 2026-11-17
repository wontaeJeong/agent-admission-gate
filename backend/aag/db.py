from pathlib import Path
from threading import RLock

from sqlalchemy import create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from .models import Audit, Base


class Database:
    def __init__(self, url, *, read_only=False):
        # One process/replica is required until this coordination is durable and shared.
        self.lifecycle_lock = RLock()
        self.lifecycle_epochs = {}
        sqlite = url.startswith("sqlite")
        if read_only and sqlite:
            parsed = make_url(url)
            if not parsed.database or parsed.database == ":memory:":
                raise ValueError("Read-only previews require an existing database")
            # mode=ro fails instead of creating missing files. Do not use immutable:
            # live WAL commits must remain visible, with normal SQLite locking.
            # SQLite may create WAL/shm coordination sidecars, but cannot change
            # database contents/schema/journal mode or create the database itself.
            url = parsed.set(
                database=Path(parsed.database).resolve().as_uri(),
                query={"mode": "ro", "uri": "true"},
            )
        elif url.startswith("sqlite:///"):
            path = url.removeprefix("sqlite:///")
            if path != ":memory:":
                Path(path).parent.mkdir(parents=True, exist_ok=True)
        kwargs = (
            {"connect_args": {"check_same_thread": False, "timeout": 30}}
            if sqlite
            else {"pool_pre_ping": True}
        )
        if read_only and not sqlite:
            kwargs["execution_options"] = {"postgresql_readonly": True}
        self.engine = create_engine(url, **kwargs)
        if sqlite:

            @event.listens_for(self.engine, "connect")
            def configure(conn, _):
                conn.execute("PRAGMA foreign_keys=ON")
                if read_only:
                    conn.execute("PRAGMA query_only=ON")
                else:
                    conn.execute("PRAGMA journal_mode=WAL")

        self.session = sessionmaker(self.engine, expire_on_commit=False)

    def create(self):
        Base.metadata.create_all(self.engine)


def audit(s, actor, action, target, **details):
    s.add(Audit(actor_id=actor, action=action, target_id=str(target), details=details))


def record(obj, exclude=()):
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns if c.name not in exclude}
