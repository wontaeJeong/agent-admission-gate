"""Bounded detection on real SQLite and PostgreSQL databases."""

import importlib
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

import pytest
from aag import models
from aag.models import (
    APIKey,
    ExceptionRule,
    Notification,
    NotificationInbox,
    NotificationPreference,
    User,
)
from sqlalchemy import event, func, select
from test_review_claims import workflow as workflow

NOW = 1800000000.125
DAY = 86400


def reminders():
    spec = importlib.util.find_spec("aag.expiration_reminders")
    assert spec is not None, "bounded expiration detector is missing"
    return importlib.import_module("aag.expiration_reminders")


def key(s, name="key", expiry=NOW + DAY, owner="owner", **kw):
    s.add(
        APIKey(
            id=name,
            owner_id=owner,
            name="Synthetic integration",
            digest=name,
            suffix="test",
            expires_at=expiry,
            **kw,
        )
    )


def rule(s, name="exception", expiry=NOW + DAY, owner="ops", **kw):
    s.add(
        ExceptionRule(
            id=name,
            created_by=owner,
            source="synthetic.zip",
            fingerprint="a" * 64,
            content_hash="b" * 64,
            reason="private",
            expires_at=expiry,
            **kw,
        )
    )


def run(app, **kw):
    return reminders().emit_due_expirations(app.state.db, now=NOW, **kw)


def counts(db):
    with db.session() as s:
        return tuple(
            s.scalar(select(func.count()).select_from(m))
            for m in (Notification, NotificationInbox, models.MaintenanceRun)
        )


def test_7d_1d_exact_boundaries():
    due = reminders().due_stage
    for delta, stage in [
        (7 * DAY + 0.001, None),
        (7 * DAY, "7d"),
        (DAY + 0.001, "7d"),
        (DAY, "1d"),
        (0.001, "1d"),
        (0, "expired"),
    ]:
        assert due(NOW + delta, NOW) == stage


def test_expired_24h_cutoff():
    due = reminders().due_stage
    assert due(NOW - DAY, NOW) == "expired"
    assert due(NOW - DAY - 0.001, NOW) is None


def test_catchup_only_most_urgent(workflow):
    app, _, _ = workflow
    with app.state.db.session.begin() as s:
        key(s, expiry=NOW + 1)
        rule(s, expiry=NOW)
    result = run(app)
    assert (result.scanned, result.emitted, result.skipped) == (2, 2, 0)
    with app.state.db.session() as s:
        assert set(s.scalars(select(Notification.kind))) == {"key.expiring_1d", "exception.expired"}


def test_two_runs_one_delivery(workflow):
    app, _, _ = workflow
    with app.state.db.session.begin() as s:
        key(s)
    assert run(app).emitted == 1
    assert run(app).scanned == 0
    assert counts(app.state.db) == (1, 1, 2)


def test_optout_and_revocation_not_candidates(workflow):
    app, _, _ = workflow
    with app.state.db.session.begin() as s:
        key(s, "off", owner="other")
        key(s, "revoked", revoked_at=NOW)
        key(s, "inactive", owner="one")
        key(s, "old", expiry=NOW - DAY - 1)
        rule(s, "not-admin", owner="owner")
        rule(s, "off-rule", active=False)
        s.get(User, "one").active = False
        s.add(NotificationPreference(user_id="other", credentials=False))
        key(s, "valid")
    result = run(app, batch_size=1, max_batches=1)
    assert (result.scanned, result.emitted) == (1, 1)
    with app.state.db.session() as s:
        assert s.scalar(select(Notification.resource_id)) == "valid"


def test_later_batches_not_starved(workflow):
    app, _, _ = workflow
    with app.state.db.session.begin() as s:
        s.add(NotificationPreference(user_id="other", credentials=False))
        s.execute(
            APIKey.__table__.insert(),
            [
                dict(
                    id=f"k{i:05}",
                    owner_id="owner" if i >= 10002 else "other",
                    name="Synthetic",
                    digest=f"bulk{i}",
                    suffix="test",
                    expires_at=NOW + DAY,
                )
                for i in range(20005)
            ],
        )
    first = run(app)
    second = run(app)
    assert (first.scanned, first.emitted, second.scanned, second.emitted) == (10000, 10000, 3, 3)
    assert run(app).scanned == 0
    assert counts(app.state.db)[0] == 10003


def test_dry_run_writes_nothing(workflow):
    app, _, _ = workflow
    module = reminders()
    with app.state.db.session.begin() as s:
        key(s)
        s.add(
            models.MaintenanceRun(
                job_name="expiration_reminders",
                started_at=NOW - 91 * DAY,
                finished_at=NOW - 91 * DAY,
                status="success",
                scanned=0,
                emitted=0,
                skipped=0,
            )
        )
    before = counts(app.state.db)
    statements = []

    def observe(conn, cursor, statement, params, ctx, many):
        statements.append(statement.lstrip().split()[0].upper())

    event.listen(app.state.db.engine, "before_cursor_execute", observe)
    try:
        result = module.emit_due_expirations(app.state.db, now=NOW, dry_run=True)
    finally:
        event.remove(app.state.db.engine, "before_cursor_execute", observe)
    assert (result.scanned, result.emitted, result.skipped) == (1, 0, 0)
    assert counts(app.state.db) == before
    assert not set(statements) & {"INSERT", "UPDATE", "DELETE", "CREATE", "ALTER"}


def test_overlap_actual_insert_count(workflow):
    app, _, _ = workflow
    with app.state.db.session.begin() as s:
        key(s)
    barrier = Barrier(2)

    def execute(_):
        barrier.wait(timeout=10)
        return run(app)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(execute, [1, 2]))
    assert sum(r.emitted for r in results) == 1
    assert counts(app.state.db)[0] == 1


def test_time_change_and_exact_expiry_identity(workflow):
    app, _, _ = workflow
    with app.state.db.session.begin() as s:
        key(s, expiry=NOW + 2 * DAY)
    module = reminders()
    assert run(app).emitted == 1
    assert module.emit_due_expirations(app.state.db, now=NOW + DAY).emitted == 1
    assert module.emit_due_expirations(app.state.db, now=NOW + 2 * DAY).emitted == 1
    assert run(app).emitted == 0
    with app.state.db.session.begin() as s:
        s.get(APIKey, "key").expires_at += 0.000001
    assert run(app).emitted == 1
    with app.state.db.session() as s:
        keys = s.scalars(select(Notification.event_key)).all()
        assert len(keys) == len(set(keys)) == 4


def test_partial_failure_is_retryable(workflow, monkeypatch):
    app, _, _ = workflow
    module = reminders()
    with app.state.db.session.begin() as s:
        key(s, "first")
        key(s, "second")
    original = module.emit_resource_notification

    def fail(s, kind, resource_type, resource_id, *args, **kw):
        if resource_id == "first":
            original(s, kind, resource_type, resource_id, *args, **kw)
            raise RuntimeError("secret must never reach diagnostics")
        return original(s, kind, resource_type, resource_id, *args, **kw)

    monkeypatch.setattr(module, "emit_resource_notification", fail)
    result = run(app, batch_size=1, max_batches=2)
    assert (result.status, result.scanned, result.emitted, result.skipped) == ("failed", 2, 1, 1)
    assert result.error_code == "candidate_failed"
    with app.state.db.session() as s:
        row = s.scalar(select(models.MaintenanceRun))
        assert row.error_code == "candidate_failed"
        assert s.get(APIKey, "first").revoked_at is None
    monkeypatch.setattr(module, "emit_resource_notification", original)
    assert run(app).emitted == 1


def test_vanished_candidate_is_bounded_skip(workflow, monkeypatch):
    app, _, _ = workflow
    module = reminders()
    with app.state.db.session.begin() as s:
        key(s)
    original = module._candidates
    calls = 0

    def disappear(*args, **kw):
        nonlocal calls
        rows = original(*args, **kw)
        if not calls:
            with app.state.db.session.begin() as s:
                s.delete(s.get(APIKey, "key"))
        calls += 1
        return rows

    monkeypatch.setattr(module, "_candidates", disappear)
    result = run(app, batch_size=1, max_batches=2)
    assert (result.scanned, result.emitted, result.skipped) == (1, 0, 1)
    assert calls <= 2


def test_cleanup_bounded_and_latest_aggregate(workflow):
    app, client, _ = workflow
    reminders()
    with app.state.db.session.begin() as s:
        s.execute(
            models.MaintenanceRun.__table__.insert(),
            [
                dict(
                    id=f"old{i}",
                    job_name="expiration_reminders",
                    started_at=NOW - 91 * DAY,
                    finished_at=NOW - 91 * DAY,
                    status="success",
                    scanned=0,
                    emitted=0,
                    skipped=0,
                )
                for i in range(1005)
            ],
        )
    run(app)
    assert counts(app.state.db)[2] == 6
    response = client.get("/api/admin/status", headers={"Cookie": "aag_session=ops"})
    assert response.status_code == 200
    assert response.json()["expiration_reminders"]["state"] == "disabled"
    assert set(response.json()["expiration_reminders"]["latest"]) == {
        "started_at",
        "finished_at",
        "status",
        "scanned",
        "emitted",
        "skipped",
        "error_code",
    }


@pytest.mark.parametrize(
    "configured,success,delta,expected",
    [
        (None, None, 0, "configuration_required"),
        ("invalid", None, 0, "configuration_required"),
        ("nan", None, 0, "configuration_required"),
        (NOW + 1, None, 0, "configuration_required"),
        (NOW, None, 7199, "waiting"),
        (NOW, None, 7200, "delayed"),
        (NOW, NOW - 3600, 7199, "waiting"),
        (NOW, NOW - 3600, 7200, "delayed"),
        (NOW, NOW + 3600, 7200, "healthy"),
        (None, NOW, 7200, "delayed"),
    ],
)
def test_activation_restart_reactivation(workflow, configured, success, delta, expected):
    app, _, _ = workflow
    module = reminders()
    settings = app.state.settings
    settings.expiry_reminders_enabled = True
    settings.expiry_reminders_enabled_at = configured
    with app.state.db.session.begin() as s:
        if success is not None:
            s.add(
                models.MaintenanceRun(
                    job_name=module.JOB_NAME,
                    started_at=success,
                    finished_at=success,
                    status="success",
                )
            )
    # Separate sessions simulate a restart: state must not depend on process startup.
    for _ in range(2):
        with app.state.db.session() as s:
            assert module.operational_status(s, settings, NOW + delta)["state"] == expected


def test_shared_resource_cap_and_invalidated_candidate(workflow, monkeypatch):
    app, _, _ = workflow
    module = reminders()
    with app.state.db.session.begin() as s:
        key(s, "a")
        rule(s, "b")
    original = module._candidates

    def revoke(*args, **kw):
        rows = original(*args, **kw)
        with app.state.db.session.begin() as s:
            s.get(APIKey, "a").revoked_at = NOW
        return rows

    monkeypatch.setattr(module, "_candidates", revoke)
    result = run(app, batch_size=1, max_batches=1)
    assert (result.scanned, result.emitted, result.skipped) == (1, 0, 1)
    monkeypatch.setattr(module, "_candidates", original)
    assert run(app, batch_size=1, max_batches=1).emitted == 1


def test_global_failure_and_cli_safe_codes(workflow, monkeypatch):
    from aag import cli, config
    from typer.testing import CliRunner

    app, _, _ = workflow
    module = reminders()
    monkeypatch.setattr(config, "get_settings", lambda: app.state.settings)
    runner = CliRunner()
    response = runner.invoke(cli.app, ["remind-expirations"])
    assert response.exit_code == 0
    assert "disabled" in response.stdout
    assert counts(app.state.db) == (0, 0, 0)
    app.state.settings.expiry_reminders_enabled = True

    def fail(*args, **kw):
        raise RuntimeError("secret database or request details")

    monkeypatch.setattr(module, "_candidates", fail)
    response = runner.invoke(cli.app, ["remind-expirations"])
    assert response.exit_code == 1
    assert "run_failed" in response.stdout and "secret" not in response.stdout
    with app.state.db.session() as s:
        row = s.scalar(select(models.MaintenanceRun))
        assert row.status == "failed" and row.error_code == "run_failed"


def test_cli_dryrun_disabled_flag_allows_readonly_preview(workflow, monkeypatch):
    from aag import cli, config
    from typer.testing import CliRunner

    app, _, _ = workflow
    reminders()
    with app.state.db.session.begin() as s:
        key(s, expiry=time.time() + DAY)
    monkeypatch.setattr(config, "get_settings", lambda: app.state.settings)
    response = CliRunner().invoke(cli.app, ["remind-expirations", "--dry-run"])
    assert response.exit_code == 0
    assert '"scanned": 1' in response.stdout and '"emitted": 0' in response.stdout
    assert counts(app.state.db) == (0, 0, 0)


def test_db_time_fixed_across_batches(workflow, monkeypatch):
    app, _, _ = workflow
    module = reminders()
    calls = []

    def clock(db):
        calls.append(1)
        return NOW if len(calls) == 1 else NOW + 8 * DAY

    monkeypatch.setattr(module, "database_now", clock)
    with app.state.db.session.begin() as s:
        key(s, "a", expiry=NOW + 2 * DAY)
        rule(s, "b", expiry=NOW + 2 * DAY)
    result = module.emit_due_expirations(app.state.db, batch_size=1, max_batches=2)
    assert calls == [1]
    assert result.emitted == 2
    with app.state.db.session() as s:
        assert set(s.scalars(select(Notification.kind))) == {
            "key.expiring_7d",
            "exception.expiring_7d",
        }


@pytest.mark.parametrize("loss", ["optout", "inactive", "admin"])
def test_recipient_recheck_after_selection(workflow, monkeypatch, loss):
    app, _, _ = workflow
    module = reminders()
    with app.state.db.session.begin() as s:
        rule(s)
    original = module._candidates

    def change(*args, **kw):
        rows = original(*args, **kw)
        if rows:
            with app.state.db.session.begin() as s:
                if loss == "optout":
                    s.add(NotificationPreference(user_id="ops", exceptions=False))
                elif loss == "inactive":
                    s.get(User, "ops").active = False
                else:
                    s.get(User, "ops").role = "user"
        return rows

    monkeypatch.setattr(module, "_candidates", change)
    result = run(app)
    assert (result.scanned, result.emitted, result.skipped) == (1, 0, 1)


def test_migration_preserves_unknown_history_and_guards_downgrade(workflow):
    import os
    import subprocess
    import sys

    from sqlalchemy import inspect, text

    app, _, _ = workflow
    engine = app.state.db.engine
    models.Base.metadata.drop_all(engine)

    def migrate(target, direction="upgrade", check=True):
        result = subprocess.run(
            [sys.executable, "-m", "alembic", direction, target],
            env={**os.environ, "AAG_DATABASE_URL": str(engine.url)},
            capture_output=True,
            text=True,
        )
        engine.dispose()
        if check:
            assert result.returncode == 0, result.stderr
        return result

    migrate("d1d1d1d1d101")
    with engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO users (id,subject,name,role,reviewer,active,created_at) VALUES ('old','local:old','Old','user',false,true,1)"
            )
        )
        c.execute(
            text(
                "INSERT INTO notifications (id,recipient_id,event_key,sequence,kind,created_at,resource_type,resource_id) VALUES ('old','old','old',1,'key.expired',1,'api_key','old-key')"
            )
        )
    migrate("head")
    assert "maintenance_runs" in inspect(engine).get_table_names()
    with engine.connect() as c:
        assert c.execute(text("SELECT id,expiry_snapshot FROM notifications")).one() == (
            "old",
            None,
        )
    migrate("d1d1d1d1d101", "downgrade")
    migrate("head")
    with engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO maintenance_runs (id,job_name,started_at,finished_at,status,scanned,emitted,skipped) VALUES ('run','expiration_reminders',1,2,'success',0,0,0)"
            )
        )
    blocked = migrate("d1d1d1d1d101", "downgrade", False)
    assert blocked.returncode != 0 and "read-compatible" in blocked.stderr
    with engine.connect() as c:
        assert c.scalar(text("SELECT count(*) FROM maintenance_runs")) == 1


def test_actual_insert_count_duplicate_and_transaction_rollback(workflow):
    from aag.notifications import emit_resource_notification

    app, _, _ = workflow
    reminders()
    with app.state.db.session.begin() as s:
        key(s)
    with app.state.db.session.begin() as s:
        assert (
            emit_resource_notification(
                s,
                "key.expiring_1d",
                "api_key",
                "key",
                ["owner"],
                "duplicate",
                expiry_snapshot=NOW + DAY,
            )
            == 1
        )
        assert (
            emit_resource_notification(
                s,
                "key.expiring_1d",
                "api_key",
                "key",
                ["owner"],
                "duplicate",
                expiry_snapshot=NOW + DAY,
            )
            == 0
        )
    before = counts(app.state.db)
    with pytest.raises(RuntimeError), app.state.db.session.begin() as s:
        assert (
            emit_resource_notification(
                s, "key.expired", "api_key", "key", ["owner"], "rollback", expiry_snapshot=NOW + DAY
            )
            == 1
        )
        raise RuntimeError("abort")
    assert counts(app.state.db) == before


def test_interruption_preserves_committed_progress_and_rerun(workflow, monkeypatch):
    app, _, _ = workflow
    module = reminders()
    with app.state.db.session.begin() as s:
        key(s, "first")
        key(s, "second")
    original = module._candidates
    calls = 0

    def interrupt(*args, **kw):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise KeyboardInterrupt()
        return original(*args, **kw)

    monkeypatch.setattr(module, "_candidates", interrupt)
    with pytest.raises(KeyboardInterrupt):
        run(app, batch_size=1, max_batches=2)
    with app.state.db.session() as s:
        row = s.scalar(select(models.MaintenanceRun))
        assert (row.status, row.scanned, row.emitted, row.finished_at) == ("running", 1, 1, None)
        assert s.scalar(select(func.count()).select_from(Notification)) == 1
    monkeypatch.setattr(module, "_candidates", original)
    assert run(app).emitted == 1
    assert counts(app.state.db)[0] == 2


def test_cli_configuration_failure_is_safe_aggregate(monkeypatch):
    from aag import cli, config
    from typer.testing import CliRunner

    def fail():
        raise RuntimeError("private connection configuration must not be printed")

    monkeypatch.setattr(config, "get_settings", fail)
    response = CliRunner().invoke(cli.app, ["remind-expirations"])
    assert response.exit_code == 1
    assert '"error_code": "run_failed"' in response.stdout
    assert "private" not in response.stdout


def test_cli_preview_preserves_unopened_delete_database(tmp_path, monkeypatch):
    import hashlib
    import json
    import sqlite3

    from aag import cli, config
    from aag.config import Settings
    from sqlalchemy import create_engine
    from typer.testing import CliRunner

    path = tmp_path / "existing.sqlite"
    url = "sqlite:///" + str(path)
    engine = create_engine(url)
    models.Base.metadata.create_all(engine)
    engine.dispose()
    with sqlite3.connect(path) as conn:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "delete"
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    files = set(tmp_path.iterdir())
    monkeypatch.setattr(config, "get_settings", lambda: Settings(database_url=url))
    result = CliRunner().invoke(cli.app, ["remind-expirations", "--dry-run"])
    assert result.exit_code == 0, result.stdout
    assert json.loads(result.stdout)["status"] == "success"
    with sqlite3.connect(path) as conn:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "delete"
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before
    assert set(tmp_path.iterdir()) == files


@pytest.mark.parametrize("missing_parent", [False, True])
def test_cli_preview_missing_database_creates_nothing(tmp_path, monkeypatch, missing_parent):
    import json

    from aag import cli, config
    from aag.config import Settings
    from typer.testing import CliRunner

    parent = tmp_path / "absent" if missing_parent else tmp_path
    path = parent / "missing.sqlite"
    monkeypatch.setattr(
        config, "get_settings", lambda: Settings(database_url="sqlite:///" + str(path))
    )
    before = set(tmp_path.rglob("*"))
    result = CliRunner().invoke(cli.app, ["remind-expirations", "--dry-run"])
    assert result.exit_code == 1
    assert json.loads(result.stdout)["error_code"] == "database_failed"
    assert set(tmp_path.rglob("*")) == before
    assert not path.exists()


def test_cli_preview_reads_committed_live_wal_changes(tmp_path, monkeypatch):
    import hashlib
    import json

    from aag import cli, config
    from aag.config import Settings
    from aag.db import Database
    from typer.testing import CliRunner

    # Keep the writer open and disable autocheckpoint: new rows live in the WAL,
    # so treating the main file as an immutable standalone DB would miss them.
    path = tmp_path / "live # preview.sqlite"
    url = "sqlite:///" + str(path)
    writer = Database(url)
    writer.create()
    connection = writer.engine.connect()
    connection.exec_driver_sql("PRAGMA wal_autocheckpoint=0")
    connection.commit()
    try:
        monkeypatch.setattr(config, "get_settings", lambda: Settings(database_url=url))
        runner = CliRunner()
        first = runner.invoke(cli.app, ["remind-expirations", "--dry-run"])
        assert first.exit_code == 0
        assert json.loads(first.stdout)["scanned"] == 0
        with writer.session.begin() as s:
            s.add(User(id="live", subject="local:live", name="Synthetic"))
            s.flush()
            key(s, owner="live", expiry=time.time() + DAY)
        wal = Path(str(path) + "-wal")
        assert wal.stat().st_size > 0
        durable_before = [hashlib.sha256(p.read_bytes()).hexdigest() for p in (path, wal)]
        second = runner.invoke(cli.app, ["remind-expirations", "--dry-run"])
        assert second.exit_code == 0
        assert json.loads(second.stdout)["scanned"] == 1
        assert [hashlib.sha256(p.read_bytes()).hexdigest() for p in (path, wal)] == durable_before
        assert counts(writer) == (0, 0, 0)
    finally:
        connection.close()
        writer.engine.dispose()


def test_preview_connection_refuses_writes_on_both_engines(workflow):
    from aag.db import Database
    from sqlalchemy.exc import DBAPIError

    app, _, _ = workflow
    preview = Database(app.state.settings.database_url, read_only=True)
    try:
        with preview.session() as s:
            assert s.get(User, "owner") is not None
        with pytest.raises(DBAPIError), preview.session.begin() as s:
            s.add(User(id="forbidden", subject="local:forbidden", name="Synthetic"))
            s.flush()
        with app.state.db.session() as s:
            assert s.get(User, "forbidden") is None
    finally:
        preview.engine.dispose()


def test_normal_database_still_creates_parent_and_uses_wal(tmp_path):
    from aag.db import Database

    path = tmp_path / "normal" / "new.sqlite"
    db = Database("sqlite:///" + str(path))
    try:
        db.create()
        with db.engine.connect() as c:
            assert c.exec_driver_sql("PRAGMA journal_mode").scalar_one() == "wal"
        assert path.exists()
    finally:
        db.engine.dispose()


def test_cli_preview_quiescent_wal_allows_only_coordination_sidecars(tmp_path, monkeypatch):
    import hashlib
    import json

    from aag import cli, config
    from aag.config import Settings
    from aag.db import Database
    from typer.testing import CliRunner

    path = tmp_path / "quiescent.sqlite"
    url = "sqlite:///" + str(path)
    writer = Database(url)
    writer.create()
    writer.engine.dispose()
    assert set(tmp_path.iterdir()) == {path}
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    monkeypatch.setattr(config, "get_settings", lambda: Settings(database_url=url))
    result = CliRunner().invoke(cli.app, ["remind-expirations", "--dry-run"])
    assert result.exit_code == 0
    assert json.loads(result.stdout)["scanned"] == 0
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before
    # SQLite may create normal WAL coordination files even in mode=ro.
    # This permission never extends to a new DB, parent, schema, or row write.
    assert set(tmp_path.iterdir()) <= {path, Path(str(path) + "-wal"), Path(str(path) + "-shm")}
    preview = Database(url, read_only=True)
    try:
        with preview.engine.connect() as c:
            assert c.exec_driver_sql("PRAGMA journal_mode").scalar_one() == "wal"
    finally:
        preview.engine.dispose()
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before
