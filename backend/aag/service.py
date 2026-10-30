import asyncio
import copy
import hashlib
import json
import tempfile
import time
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import select, update

from . import llm
from .db import audit, record
from .models import ExceptionRule, Job
from .policy import builtin_scan, decide, finding
from .scanners import external
from .sources import SourceError, clone, content_hash, extract_zip, validate_git_url

TERMINAL = {"COMPLETED", "FAILED", "CANCELLED"}


def owned_job(s, job_id, actor):
    job = s.get(Job, job_id)
    if not job or (job.owner_id != actor.id and (actor.key_id or not actor.staff)):
        raise HTTPException(404, "Scan not found")
    return job


class ScanService:
    def __init__(self, db, settings):
        self.db, self.settings = db, settings
        self.slots = asyncio.Semaphore(settings.runner_concurrency)
        self.tasks = {}
        self.upload_bytes = 0

    def recover(self):
        with self.db.session.begin() as s:
            s.execute(
                update(Job)
                .where(Job.status.in_(["PENDING", "RUNNING"]))
                .values(
                    status="FAILED",
                    error="Service restarted before completion. Resubmit the source; temporary credentials are never persisted.",
                    completed_at=time.time(),
                )
            )

    async def shutdown(self):
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def submit(
        self,
        actor,
        request=None,
        upload=None,
        filename=None,
        upload_profile="static",
        upload_force=False,
    ):
        actor.scope("scan:write")
        if len(self.tasks) >= self.settings.queue_capacity or (
            upload and self.upload_bytes + len(upload) > self.settings.max_extracted_bytes
        ):
            raise HTTPException(429, "Scan queue is full", headers={"Retry-After": "10"})
        if request:
            try:
                url = await asyncio.to_thread(
                    validate_git_url, request.url, self.settings.allowed_git_hosts
                )
            except ValueError as e:
                raise HTTPException(422, str(e)) from e
        with self.db.session.begin() as s:
            job = Job(
                owner_id=actor.id,
                source=url if request else Path(filename or "upload.zip").name[:200],
                source_type="git" if request else "upload",
                ref=request.ref if request else None,
                profile=request.profile if request else upload_profile,
            )
            s.add(job)
            s.flush()
            audit(
                s, actor.id, "scan.create", job.id, profile=job.profile, source_type=job.source_type
            )
            result = record(job)
        secret = request.credential.get_secret_value() if request and request.credential else None
        size = len(upload) if upload else 0
        self.upload_bytes += size
        task = asyncio.create_task(
            self.run(job.id, upload, secret, request.force_rescan if request else upload_force)
        )
        self.tasks[job.id] = task

        def finished(_):
            self.tasks.pop(job.id, None)
            self.upload_bytes -= size

        task.add_done_callback(finished)
        return result

    async def cancel(self, job_id, actor):
        actor.scope("scan:write")
        with self.db.session.begin() as s:
            job = owned_job(s, job_id, actor)
            if job.owner_id != actor.id and actor.role != "admin":
                raise HTTPException(403, "Only owner or administrator can cancel")
            if job.status in TERMINAL:
                raise HTTPException(409, "Scan already finished")
            job.status, job.completed_at = "CANCELLED", time.time()
            audit(s, actor.id, "scan.cancel", job.id)
        if task := self.tasks.get(job_id):
            task.cancel()
        return {"status": "CANCELLED"}

    def progress(self, job_id, result):
        with self.db.session.begin() as s:
            job = s.get(Job, job_id)
            if job.status == "RUNNING":
                job.result = copy.deepcopy(result)

    async def run(self, job_id, upload, credential, force):
        try:
            async with self.slots:
                with self.db.session.begin() as s:
                    job = s.get(Job, job_id)
                    if job.status != "PENDING":
                        return
                    job.status, job.started_at = "RUNNING", time.time()
                async with asyncio.timeout(self.settings.scan_timeout * 3):
                    with tempfile.TemporaryDirectory(prefix="aag-") as directory:
                        work = Path(directory)
                        if upload is not None:
                            root = work / "source"
                            root.mkdir()
                            files = await asyncio.to_thread(
                                extract_zip, upload, root, self.settings
                            )
                            revision = None
                        else:
                            root, files, revision = await clone(
                                job.source, job.ref, credential, work, self.settings
                            )
                        credential, upload = None, None
                        if not files:
                            raise SourceError("No files to scan")
                        checksum = await asyncio.to_thread(content_hash, files, root)
                        config = [
                            checksum,
                            job.profile,
                            self.settings.policy_version,
                            self.settings.scanner_revision,
                            self.settings.llm_provider,
                            self.settings.llm_model,
                            self.settings.systemone_review_threshold,
                            self.settings.osv_enabled,
                        ]
                        cache_key = hashlib.sha256(json.dumps(config).encode()).hexdigest()
                        with self.db.session.begin() as s:
                            row = s.get(Job, job_id)
                            row.content_hash, row.cache_key, row.resolved_commit = (
                                checksum,
                                cache_key,
                                revision,
                            )
                            cached = (
                                None
                                if force
                                else s.scalar(
                                    select(Job)
                                    .where(
                                        Job.owner_id == job.owner_id,
                                        Job.cache_key == cache_key,
                                        Job.status == "COMPLETED",
                                        Job.completed_at
                                        > time.time() - self.settings.cache_seconds,
                                    )
                                    .order_by(Job.completed_at.desc())
                                )
                            )
                            if cached and cached.result.get("coverage_complete"):
                                result = copy.deepcopy(cached.result)
                                row.cached_from = cached.id
                            else:
                                result = None
                        if result is None:
                            result = await self.scan(job, files, root, work)
                        with self.db.session.begin() as s:
                            exceptions = s.scalars(
                                select(ExceptionRule).where(
                                    ExceptionRule.active.is_(True),
                                    ExceptionRule.source == job.source,
                                    ExceptionRule.content_hash == checksum,
                                    ExceptionRule.expires_at > time.time(),
                                )
                            ).all()
                            for f in result["findings"]:
                                f["suppressed"] = any(
                                    e.fingerprint == f["fingerprint"] for e in exceptions
                                )
                            verdict = decide(result["findings"], result["engines"])
                            row = s.get(Job, job_id)
                            row.status, row.verdict, row.effective_verdict = (
                                "COMPLETED",
                                verdict,
                                verdict,
                            )
                            row.result, row.completed_at = result, time.time()
                            audit(
                                s,
                                row.owner_id,
                                "scan.complete",
                                row.id,
                                verdict=verdict,
                                cached=bool(row.cached_from),
                            )
        except asyncio.CancelledError:
            self.fail(job_id, "CANCELLED", "Scan cancelled; temporary workspace removed")
            raise
        except TimeoutError:
            self.fail(job_id, "FAILED", "Scan exceeded overall time limit")
        except SourceError as e:
            self.fail(job_id, "FAILED", str(e))
        except Exception:
            self.fail(job_id, "FAILED", "Scan execution failed; no admission granted")

    def fail(self, job_id, status, message):
        with self.db.session.begin() as s:
            job = s.get(Job, job_id)
            if job and job.status not in TERMINAL:
                job.status, job.error, job.completed_at = status, message, time.time()
                audit(s, job.owner_id, "scan." + status.lower(), job.id)

    async def scan(self, job, files, root, work):
        started = time.time()
        findings, coverage = await asyncio.to_thread(builtin_scan, files, root)
        engines = [
            {
                "name": "builtin",
                "status": "completed"
                if not coverage["skipped"] and not coverage["truncated"]
                else "partial",
                "required": True,
                "started_at": started,
                "duration_ms": (time.time() - started) * 1000,
                **coverage,
            }
        ]
        result = {
            "findings": findings,
            "engines": engines,
            "policy_version": self.settings.policy_version,
            "scanner_revision": self.settings.scanner_revision,
            "limitations": [
                "Static evidence only; uploaded code and MCP tools are never executed.",
                "ALLOW applies only to this source snapshot, selected profile and policy version.",
            ],
        }
        self.progress(job.id, result)
        plan = []
        for file in files:
            if file.name == "SKILL.md":
                plan.append(
                    ("skill", ["skill-scanner", "scan", str(file.parent), "--format", "json"])
                )
            if file.name == "tools.json":
                plan.append(
                    (
                        "mcp",
                        [
                            "mcp-scanner",
                            "--analyzers",
                            "yara",
                            "--format",
                            "raw",
                            "static",
                            "--tools",
                            str(file),
                        ],
                    )
                )
        if job.profile == "full":
            plan.append(("syft", ["syft", "scan", "dir:" + str(root), "-o", "syft-json"]))
        (work / ".grant.yaml").write_text(
            "allow: [MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Unlicense]\nrequire-license: true\nrequire-known-license: true\n"
        )
        sbom = None
        for name, argv in plan:
            engine, found, payload = await external(name, argv, work, self.settings)
            engines.append(engine)
            findings.extend(found)
            if name == "syft" and engine["status"] == "completed":
                sbom = payload
                (work / "sbom.json").write_text(json.dumps(payload))
                result["sbom"] = {
                    "packages": [
                        {
                            "name": p.get("name"),
                            "version": p.get("version"),
                            "purl": p.get("purl"),
                            "licenses": p.get("licenses", []),
                        }
                        for p in payload["artifacts"]
                    ]
                }
            self.progress(job.id, result)
        if job.profile == "full":
            if sbom is not None:
                for name, argv in [
                    ("grype", ["grype", "sbom:" + str(work / "sbom.json"), "-o", "json"]),
                    ("grant", ["grant", "check", str(work / "sbom.json"), "-o", "json"]),
                ]:
                    engine, found, payload = await external(name, argv, work, self.settings)
                    if name == "grant" and engine["status"] == "completed":
                        count = sum(
                            t["evaluation"]["summary"]["packages"].get(
                                "cataloged", t["evaluation"]["summary"]["packages"]["total"]
                            )
                            for t in payload["run"]["targets"]
                        )
                        engine["packages"] = count
                        if count != len(sbom["artifacts"]):
                            engine.update(
                                status="partial", error="Syft and Grant package counts differ"
                            )
                    engines.append(engine)
                    findings.extend(found)
                    self.progress(job.id, result)
            else:
                engines.extend(
                    {
                        "name": n,
                        "status": "skipped",
                        "required": True,
                        "error": "SBOM generation did not complete",
                    }
                    for n in ("grype", "grant")
                )
            if self.settings.osv_enabled:
                engine, found, _ = await external(
                    "osv",
                    ["osv-scanner", "scan", "source", "--recursive", "--format=json", str(root)],
                    work,
                    self.settings,
                )
                engines.append(engine)
                findings.extend(found)
            if self.settings.llm_provider != "disabled":
                start = time.time()
                engine = {"name": "llm", "required": True, "started_at": start}
                try:
                    advice = await llm.judge(
                        self.settings,
                        {"findings": findings[:200], "file_count": len(files)},
                        self.db,
                        job,
                    )
                    result["llm"] = advice
                    engine["status"] = "completed"
                    if advice["needs_review"]:
                        findings.append(
                            finding(
                                "llm",
                                "advisory.review",
                                "medium",
                                "Model recommends human review",
                                evidence=advice["reason"],
                            )
                        )
                except Exception:
                    engine.update(
                        status="failed",
                        error="Model unavailable or response invalid; review required",
                    )
                engine["duration_ms"] = (time.time() - start) * 1000
                engines.append(engine)
            else:
                engines.append(
                    {
                        "name": "llm",
                        "required": True,
                        "status": "unavailable",
                        "error": "Full profile requires a configured advisory model",
                    }
                )
        result["coverage_complete"] = all(
            not e["required"] or e["status"] == "completed" for e in engines
        )
        return result
