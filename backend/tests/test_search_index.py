import pytest
from aag.models import Job
from conftest import upload, wait_job
from sqlalchemy import select
from test_review_claims import workflow as workflow
from test_search import seed


def test_safe_index_and_atomic_rollback(app, client, people):
    from aag.models import FindingIndex
    from aag.search_index import index_job_findings

    seed(app, people)
    with pytest.raises(RuntimeError):
        with app.state.db.session.begin() as s:
            job = s.get(Job, "alice-scan")
            job.result = {"findings": [{"fingerprint": "new", "title": "new result"}]}
            index_job_findings(s, job)
            s.flush()
            raise RuntimeError("rollback")
    with app.state.db.session() as s:
        assert s.get(Job, "alice-scan").result["findings"][0]["title"] == "first"
        assert s.get(Job, "alice-scan").finding_index_version is None
        assert not s.scalars(select(FindingIndex)).all()
    with app.state.db.session.begin() as s:
        job = s.get(Job, "alice-scan")
        job.result = {
            "findings": [
                {
                    "fingerprint": "safe",
                    "title": "CVE test",
                    "evidence": "private evidence",
                    "remediation": "private remedy",
                    "path": "https://user:password@example.test/file?token=private",
                    "engine": "scanner",
                    "rule": "safe",
                    "action": "BLOCK",
                    "severity": "high",
                }
            ],
            "error": "private error",
        }
        index_job_findings(s, job)
    with app.state.db.session() as s:
        row = s.scalar(select(FindingIndex))
        assert "password" not in row.search_text
        assert "private" not in row.search_text
        assert "CVE test" in row.title


def test_backfill_resume_and_idempotency(app, client, people):
    from aag.models import FindingIndex
    from aag.search_index import reindex_findings

    seed(app, people)
    stream = reindex_findings(app.state.db, batch_size=1)
    assert next(stream) == 1
    stream.close()
    assert sum(reindex_findings(app.state.db, batch_size=1)) == 1
    assert sum(reindex_findings(app.state.db, batch_size=1)) == 0
    with app.state.db.session() as s:
        assert len(s.scalars(select(FindingIndex)).all()) == 4


def test_completed_and_cached_jobs_index_in_same_owner(app, client, people):
    from aag.models import FindingIndex
    from aag.search_index import INDEX_VERSION
    from conftest import login

    login(client, "alice")
    first = wait_job(
        client, upload(client, {"x.py": "import subprocess\nsubprocess.run('test', shell=True)"})
    )
    second = wait_job(
        client, upload(client, {"x.py": "import subprocess\nsubprocess.run('test', shell=True)"})
    )
    assert second["cached_from"] == first["id"]
    with app.state.db.session() as s:
        for item in (first, second):
            job = s.get(Job, item["id"])
            assert job.finding_index_version == INDEX_VERSION
            assert job.owner_id == people["alice"]["id"]
            assert s.scalars(select(FindingIndex).where(FindingIndex.job_id == job.id)).all()


def test_sqlite_postgres_fixture_and_migration(workflow):
    import os
    import subprocess
    import sys

    from aag.models import Base, FindingIndex
    from aag.search_index import index_job_findings
    from sqlalchemy import inspect, text

    app, _, _ = workflow
    engine = app.state.db.engine
    Base.metadata.drop_all(engine)

    def migrate(target):
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", target],
            env={**os.environ, "AAG_DATABASE_URL": str(engine.url)},
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr
        engine.dispose()

    migrate("c3c3c3c3c303")
    with engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO users (id,subject,name,role,reviewer,active,created_at) VALUES ('search-owner','local:search-owner','Search','user',false,true,1)"
            )
        )
        c.execute(
            text(
                "INSERT INTO jobs (id,owner_id,source,source_type,profile,status,result,created_at) VALUES ('legacy','search-owner','legacy.zip','upload','static','COMPLETED',:result,1)"
            ),
            {
                "result": '{"findings":[{"fingerprint":"duplicate","rule":"CVE-2026","title":"first"},{"fingerprint":"duplicate","rule":"CVE-2026","title":"second"}]}'
            },
        )
    migrate("head")
    assert {"job_id", "ordinal"} == set(
        inspect(engine).get_pk_constraint("finding_index")["constrained_columns"]
    )
    with app.state.db.session.begin() as s:
        job = s.get(Job, "legacy")
        assert job.finding_index_version is None
        index_job_findings(s, job)
    with app.state.db.session() as s:
        rows = s.scalars(select(FindingIndex).order_by(FindingIndex.ordinal)).all()
        assert [(r.ordinal, r.title, r.rule) for r in rows] == [
            (0, "first", "CVE-2026"),
            (1, "second", "CVE-2026"),
        ]


def test_100k_first_next_page_and_actual_query_plan(workflow):
    import time

    from aag.auth import Actor
    from aag.routes_search import query_for
    from aag.search_index import index_job_findings
    from sqlalchemy import and_, or_, text

    app, client, _ = workflow
    app.state.settings.search_enabled = True
    with app.state.db.session.begin() as s:
        old = s.get(Job, "job")
        old.result = {"findings": []}
        index_job_findings(s, old)
        for n in range(100):
            job = Job(
                id=f"bulk-{n:03d}",
                owner_id="owner",
                source="synthetic.zip",
                source_type="upload",
                profile="static",
                status="COMPLETED",
                effective_verdict="BLOCK",
                created_at=1000 + n,
                result={
                    "findings": [
                        {
                            "fingerprint": f"fp-{i // 2}",
                            "rule": "CVE-2026-1234",
                            "engine": "synthetic",
                            "title": "Synthetic finding",
                            "path": f"src/{i}.py",
                            "severity": "high",
                            "action": "BLOCK",
                        }
                        for i in range(1000)
                    ]
                },
            )
            s.add(job)
            s.flush()
            index_job_findings(s, job)
    elapsed = []
    payload = None
    for _ in range(2):
        params = {"q": "CVE-2026", "type": "findings", "page_size": 25}
        if payload:
            params["cursor"] = payload["next_cursor"]
        start = time.perf_counter()
        r = client.get("/api/search", params=params, headers={"Cookie": "aag_session=owner"})
        elapsed.append(round((time.perf_counter() - start) * 1000, 2))
        assert r.status_code == 200
        payload = r.json()
        assert payload["total"] == 100000 and len(payload["items"]) == 25
    assert payload["items"][0]["id"] == "bulk-099:25"
    assert "occurrence=1" in payload["items"][0]["href"]
    query, created, identity, ordinal = query_for(
        Actor("owner", "Owner", "user", True), "findings", "personal", ["CVE-2026"]
    )
    statements = [
        query.order_by(created.desc(), identity.desc(), ordinal).limit(26),
        query.where(
            or_(
                created < 1099,
                and_(created == 1099, identity < "bulk-099"),
                and_(created == 1099, identity == "bulk-099", ordinal > 24),
            )
        )
        .order_by(created.desc(), identity.desc(), ordinal)
        .limit(26),
    ]
    plans = []
    with app.state.db.engine.connect() as c:
        for stmt in statements:
            sql = str(stmt.compile(dialect=c.dialect, compile_kwargs={"literal_binds": True}))
            prefix = (
                "EXPLAIN QUERY PLAN "
                if c.dialect.name == "sqlite"
                else "EXPLAIN (ANALYZE, BUFFERS) "
            )
            plans.append("\n".join(str(row) for row in c.execute(text(prefix + sql))))
    print(
        f"\nSEARCH_BENCH engine={app.state.db.engine.dialect.name} findings=100000 first_ms={elapsed[0]} next_ms={elapsed[1]}\nFIRST PLAN\n{plans[0]}\nNEXT PLAN\n{plans[1]}"
    )


def test_dual_engine_backfill_interruption_live_review_and_rollback(workflow):
    from aag.models import FindingIndex, Review
    from aag.search_index import index_job_findings, reindex_findings

    app, client, _ = workflow
    app.state.settings.search_enabled = True
    with app.state.db.session.begin() as s:
        original = s.get(Job, "job")
        original.result = {"findings": []}
        index_job_findings(s, original)
        for n in range(3):
            s.add(
                Job(
                    id=f"reindex-{n}",
                    owner_id="owner",
                    source="resume.zip",
                    source_type="upload",
                    profile="static",
                    status="COMPLETED",
                    effective_verdict="BLOCK",
                    result={
                        "findings": [{"fingerprint": "fp", "title": "needle", "rule": "CVE-test"}]
                    },
                )
            )
    stream = reindex_findings(app.state.db, batch_size=1)
    assert next(stream) == 1
    stream.close()
    with app.state.db.session() as s:
        assert len(s.scalars(select(FindingIndex)).all()) == 1
    r = client.get("/api/search?q=needle&type=findings", headers={"Cookie": "aag_session=owner"})
    assert r.json()["total"] is None
    assert sum(reindex_findings(app.state.db, batch_size=1)) == 2
    with pytest.raises(RuntimeError):
        with app.state.db.session.begin() as s:
            job = s.get(Job, "reindex-0")
            job.result = {"findings": []}
            index_job_findings(s, job)
            raise RuntimeError("synthetic rollback")
    with app.state.db.session.begin() as s:
        assert len(s.scalars(select(FindingIndex)).all()) == 3
        job = s.get(Job, "reindex-0")
        job.effective_verdict = "ALLOW"
        s.add(
            Review(
                id="live-review",
                job_id=job.id,
                requester_id="owner",
                reason="needle",
                status="approved",
                decision_reason="current decision",
            )
        )
    r = client.get("/api/search?q=needle&type=findings", headers={"Cookie": "aag_session=owner"})
    assert r.json()["total"] == 3
    item = next(x for x in r.json()["items"] if x["id"] == "reindex-0:0")
    assert "ALLOW" in item["safe_snippet"] and "approved" in item["safe_snippet"]
