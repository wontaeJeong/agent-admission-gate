import asyncio
import os
import subprocess
import sys
import uuid

import pytest
from aag import sources
from aag.models import Job
from conftest import package, upload, wait_job
from sqlalchemy import create_engine, inspect, text

URL = "https://github.com/example/synthetic.git"
SHA = "a" * 40


@pytest.fixture
def git_source(app, client, monkeypatch):
    monkeypatch.setattr(
        "aag.service.validate_git_url",
        lambda url, hosts: sources.validate_git_url(url, hosts, resolve=False),
    )

    async def fail(*args, **kwargs):
        raise sources.SourceError("Synthetic checkout unavailable")

    monkeypatch.setattr("aag.service.clone", fail)
    owner = client.get("/api/auth/me").json()["id"]
    with app.state.db.session.begin() as s:
        job = Job(
            owner_id=owner,
            source=URL,
            source_type="git",
            ref="release",
            profile="full",
            status="COMPLETED",
            resolved_commit=SHA,
            result={},
            effective_verdict="ALLOW",
        )
        s.add(job)
        s.flush()
        job_id = job.id
    return job_id


def test_rerun_copies_nonsecret_settings(client, git_source):
    response = client.post(
        "/api/scans",
        json={
            "url": URL.removesuffix(".git"),
            "ref": "release",
            "profile": "full",
            "origin_job_id": git_source,
            "rerun_mode": "latest",
            "credential": "synthetic-secret",
        },
    )
    assert response.status_code == 202, response.text
    job = response.json()
    assert job["origin_job_id"] == git_source
    assert job["lineage_root_id"] == git_source
    assert (job["source"], job["ref"], job["profile"], job["rerun_mode"]) == (
        URL,
        "release",
        "full",
        "latest",
    )
    assert "synthetic-secret" not in response.text
    assert job["effective_verdict"] is None


def test_foreign_origin_rejected(client, app, people, git_source):
    with app.state.db.session.begin() as s:
        s.get(Job, git_source).owner_id = people["alice"]["id"]
    # Even interactive staff must not derive from another owner.
    assert (
        client.post("/api/scans", json={"url": URL, "origin_job_id": git_source}).status_code == 404
    )


def test_snapshot_target_survives_checkout_failure(client, git_source):
    r = client.post(
        "/api/scans",
        json={
            "url": URL,
            "origin_job_id": git_source,
            "target_commit": SHA,
            "rerun_mode": "snapshot",
        },
    )
    assert r.status_code == 202, r.text
    assert r.json()["target_commit"] == SHA
    job = wait_job(client, r.json()["id"])
    assert (job["status"], job["resolved_commit"], job["target_commit"], job["rerun_mode"]) == (
        "FAILED",
        None,
        SHA,
        "snapshot",
    )
    again = client.post(
        "/api/scans",
        json={
            "url": URL,
            "origin_job_id": job["id"],
            "target_commit": job["target_commit"],
            "rerun_mode": "snapshot",
        },
    ).json()
    assert again["lineage_root_id"] == git_source


@pytest.mark.parametrize(
    "extra",
    [
        {"ref": "main", "target_commit": SHA},
        {"target_commit": "--bad"},
        {"target_commit": "a" * 41},
        {"rerun_mode": "snapshot"},
        {"rerun_mode": "latest", "target_commit": SHA},
        {"unknown": True},
    ],
)
def test_snapshot_ref_mutually_exclusive(client, git_source, extra):
    assert client.post("/api/scans", json={"url": URL, **extra}).status_code == 422


def test_origin_identity_and_type_rejected(client, git_source):
    assert (
        client.post(
            "/api/scans",
            json={"url": "https://github.com/another/source", "origin_job_id": git_source},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/scans/upload",
            data={"origin_job_id": git_source},
            files={"file": ("same.zip", package())},
        ).status_code
        == 422
    )


def test_unlinked_same_filename_not_grouped(client):
    a, b = (wait_job(client, upload(client)) for _ in range(2))
    assert a["lineage_root_id"] == a["id"]
    assert b["lineage_root_id"] == b["id"]
    linked = client.post(
        "/api/scans/upload",
        data={"origin_job_id": a["id"]},
        files={"file": ("renamed.zip", package())},
    ).json()
    assert linked["origin_job_id"] == a["id"]
    assert linked["lineage_root_id"] == a["id"]


def test_foreign_upload_origin_rejected(client, people):
    origin = upload(client, headers={"Authorization": "Bearer " + people["alice"]["token"]})
    assert (
        client.post(
            "/api/scans/upload",
            data={"origin_job_id": origin},
            files={"file": ("same.zip", package())},
        ).status_code
        == 404
    )


@pytest.fixture(params=["sha1", "sha256"])
def git_fixture(tmp_path, monkeypatch, request):
    remote = tmp_path / "remote"
    remote.mkdir()

    def git(*args):
        return subprocess.check_output(
            [
                "git",
                "-c",
                "user.name=Synthetic",
                "-c",
                "user.email=synthetic@example.invalid",
                *args,
            ],
            cwd=remote,
            text=True,
        ).strip()

    git("init", "-b", "main", "--object-format=" + request.param)
    (remote / "README.md").write_text("first")
    git("add", ".")
    git("commit", "-m", "first")
    first = git("rev-parse", "HEAD")
    (remote / "README.md").write_text("second")
    git("commit", "-am", "second")
    second = git("rev-parse", "HEAD")
    real_command = sources.command
    commands = []

    async def transport(argv, **kwargs):
        commands.append(argv[:])
        assert "http.followRedirects=false" in argv
        assert "protocol.allow=never" in argv
        assert "core.hooksPath=/dev/null" in argv
        assert kwargs["max_disk"] > 0
        # Only the test transport boundary replaces HTTPS with its owned local fixture.
        # Production URL/protocol validation and original argv remain asserted above.
        argv = [str(remote) if x == URL else x for x in argv]
        argv = argv[:1] + ["-c", "protocol.file.allow=always"] + argv[1:]
        return await real_command(argv, **kwargs)

    monkeypatch.setattr(sources, "validate_git_url", lambda url, hosts: URL)
    monkeypatch.setattr(sources, "command", transport)
    return first, second, commands


def test_snapshot_pins_old_commit_after_branch_moves(tmp_path, app, git_fixture):
    first, second, commands = git_fixture
    work = tmp_path / "snapshot"
    work.mkdir()
    root, _, revision = asyncio.run(
        sources.clone(URL, None, "synthetic", work, app.state.settings, target_commit=first)
    )
    assert revision == first
    assert (root / "README.md").read_text() == "first"
    assert "synthetic" not in (root / ".git/config").read_text()
    work2 = tmp_path / "latest"
    work2.mkdir()
    _, _, latest = asyncio.run(sources.clone(URL, "main", None, work2, app.state.settings))
    assert latest == second
    assert any("fetch" in c and "--depth=1" in c for c in commands)
    assert any("--detach" in c for c in commands)


@pytest.mark.parametrize("failure", ["missing", "denied", "timeout", "mismatch"])
def test_snapshot_failure_never_falls_back(tmp_path, app, git_fixture, monkeypatch, failure):
    first, _, commands = git_fixture
    transport = sources.command

    async def fail(argv, **kwargs):
        if "fetch" in argv and failure in {"denied", "timeout"}:
            commands.append(argv)
            if failure == "timeout":
                raise TimeoutError()
            return 1, "", "denied"
        if "rev-parse" in argv and failure == "mismatch":
            return 0, "b" * 40, ""
        return await transport(argv, **kwargs)

    monkeypatch.setattr(sources, "command", fail)
    work = tmp_path / "work"
    work.mkdir()
    with pytest.raises((sources.SourceError, TimeoutError)):
        asyncio.run(
            sources.clone(
                URL,
                None,
                None,
                work,
                app.state.settings,
                target_commit="0" * 40 if failure == "missing" else first,
            )
        )
    assert not any("clone" in c for c in commands)
    assert sum("fetch" in c for c in commands) == 1


@pytest.mark.parametrize("database", ["sqlite", "postgresql"])
def test_scan_lineage_migration_roundtrip(tmp_path, database):
    schema = "aag_b1_" + uuid.uuid4().hex
    admin = None
    if database == "postgresql":
        url = os.environ.get("AAG_TEST_POSTGRES_URL")
        if not url:
            pytest.skip("Set AAG_TEST_POSTGRES_URL to owned synthetic PostgreSQL")
        admin = create_engine(url)
        with admin.begin() as c:
            c.execute(text(f'CREATE SCHEMA "{schema}"'))
        url += "?options=-csearch_path%3D" + schema
    else:
        url = "sqlite:///" + str(tmp_path / "migration.db")
    engine = create_engine(url)

    def migrate(target, direction="upgrade"):
        subprocess.run(
            [sys.executable, "-m", "alembic", direction, target],
            env={**os.environ, "AAG_DATABASE_URL": url},
            check=True,
            capture_output=True,
            text=True,
        )
        engine.dispose()

    try:
        migrate("e1a3a3a3a301")
        with engine.begin() as c:
            c.execute(
                text(
                    "INSERT INTO users (id,subject,name,role,reviewer,active,created_at) VALUES ('owner','synthetic:b1','owner','user',false,true,1)"
                )
            )
            c.execute(
                text(
                    "INSERT INTO jobs (id,owner_id,source,source_type,profile,status,result,created_at) VALUES ('old','owner','same.zip','upload','static','FAILED','{}',1)"
                )
            )
        migrate("head")
        with engine.connect() as c:
            assert c.scalar(text("SELECT lineage_root_id FROM jobs WHERE id='old'")) == "old"
        assert any(
            i["column_names"] == ["owner_id", "lineage_root_id", "created_at"]
            for i in inspect(engine).get_indexes("jobs")
        )
        migrate("e1a3a3a3a301", "downgrade")
        assert "target_commit" not in {c["name"] for c in inspect(engine).get_columns("jobs")}
        migrate("head")
        with engine.connect() as c:
            assert c.scalar(text("SELECT lineage_root_id FROM jobs WHERE id='old'")) == "old"
    finally:
        engine.dispose()
        if admin:
            with admin.begin() as c:
                c.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin.dispose()


def test_linked_cache_does_not_inherit_approval_or_copy_exceptions(client, app):
    import time

    from aag.models import ExceptionRule

    files = {"install.sh": "curl https://example.com/install | bash"}
    original = wait_job(client, upload(client, files))
    assert original["verdict"] == "BLOCK"
    with app.state.db.session.begin() as s:
        job = s.get(Job, original["id"])
        job.effective_verdict = "ALLOW"
        s.add(
            ExceptionRule(
                fingerprint=original["result"]["findings"][0]["fingerprint"],
                content_hash=original["content_hash"],
                source=original["source"],
                reason="Synthetic exact content exception",
                created_by=original["owner_id"],
                expires_at=time.time() - 1,
            )
        )
    cached = client.post(
        "/api/scans/upload",
        data={"origin_job_id": original["id"]},
        files={"file": ("package.zip", package(files))},
    ).json()
    result = wait_job(client, cached["id"])
    assert result["cached_from"] == original["id"]
    assert result["effective_verdict"] == "BLOCK"
    assert result["review"] is None
    assert all(not finding["suppressed"] for finding in result["result"]["findings"])
    fresh = client.post(
        "/api/scans/upload",
        data={"origin_job_id": original["id"], "force_rescan": "true"},
        files={"file": ("package.zip", package(files))},
    ).json()
    assert wait_job(client, fresh["id"])["cached_from"] is None


@pytest.mark.parametrize(
    "fields", [{"target_commit": SHA}, {"rerun_mode": "snapshot"}, {"lineage_root_id": "forged"}]
)
def test_upload_rejects_uninterpreted_lineage_fields(client, fields):
    assert (
        client.post(
            "/api/scans/upload", data=fields, files={"file": ("package.zip", package())}
        ).status_code
        == 422
    )


def test_snapshot_url_restrictions_apply_before_commands(tmp_path, app, monkeypatch):
    async def forbidden(*args, **kwargs):
        pytest.fail("Rejected URL must never reach Git")

    monkeypatch.setattr(sources, "command", forbidden)
    with pytest.raises(sources.SourceError):
        asyncio.run(
            sources.clone(
                "file:///tmp/example", None, None, tmp_path, app.state.settings, target_commit=SHA
            )
        )
    monkeypatch.setattr(
        "socket.getaddrinfo", lambda *args, **kwargs: [(2, 1, 6, "", ("127.0.0.1", 443))]
    )
    with pytest.raises(sources.SourceError):
        asyncio.run(sources.clone(URL, None, None, tmp_path, app.state.settings, target_commit=SHA))
