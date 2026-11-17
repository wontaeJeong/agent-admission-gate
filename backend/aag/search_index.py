"""Bounded public finding projection; never copy evidence, errors or model text."""

import re
from urllib.parse import urlsplit, urlunsplit

from sqlalchemy import delete, or_, select

from .models import FindingIndex, Job

INDEX_VERSION = 1


def pending_index():
    return or_(
        Job.finding_index_version.is_(None),
        Job.finding_index_version != INDEX_VERSION,
        select(FindingIndex.job_id)
        .where(
            FindingIndex.job_id == Job.id,
            FindingIndex.schema_version != INDEX_VERSION,
        )
        .exists(),
    )


FIELDS = ("engine", "rule", "severity", "title", "path", "action")


def safe_text(value, limit=500):
    if not isinstance(value, str):
        return ""
    value = "".join(c if c.isprintable() else " " for c in value)

    def clean_url(match):
        try:
            url = urlsplit(match.group())
            host = url.hostname or ""
            if ":" in host:
                host = "[" + host + "]"
            if url.port:
                host += ":" + str(url.port)
            return urlunsplit((url.scheme, host, url.path, "", ""))
        except ValueError:
            return "[redacted]"

    value = re.sub(r"https?://[^\s<>]+", clean_url, value)
    value = re.sub(
        r"(?i)\b(?:bearer\s+\S+|(?:aag_sk_|gh[pousr]_|github_pat_|sk-)[A-Za-z0-9_-]+)",
        "[redacted]",
        value,
    )
    value = re.sub(
        r"(?i)\b(password|secret|token|api[_-]?key|credential)\s*[:=]\s*\S+",
        r"\1=[redacted]",
        value,
    )
    return value[:limit]


def index_job_findings(s, job) -> None:
    """Caller owns the result + index transaction. Version is set only after flush."""
    if job.status != "COMPLETED":
        return
    findings = job.result.get("findings") if isinstance(job.result, dict) else None
    if not isinstance(findings, list) or any(not isinstance(f, dict) for f in findings):
        # Historical malformed results must remain visibly unindexed.
        job.finding_index_version = None
        s.execute(delete(FindingIndex).where(FindingIndex.job_id == job.id))
        return
    s.execute(delete(FindingIndex).where(FindingIndex.job_id == job.id))
    for ordinal, finding in enumerate(findings):
        fields = {k: safe_text(finding.get(k)) for k in FIELDS}
        fingerprint = finding.get("fingerprint")
        if not isinstance(fingerprint, str) or not re.fullmatch(
            r"[A-Za-z0-9_-]{1,128}", fingerprint
        ):
            fingerprint = ""
        line = finding.get("line")
        s.add(
            FindingIndex(
                job_id=job.id,
                ordinal=ordinal,
                fingerprint=fingerprint,
                line=line if type(line) is int and 0 < line < 2**31 else None,
                search_text=" ".join(fields.values()).lower(),
                schema_version=INDEX_VERSION,
                **fields,
            )
        )
    s.flush()
    job.finding_index_version = INDEX_VERSION


def reindex_findings(db, batch_size=100):
    """Commit one job at a time; resume by version, IDs bounded and result read singly."""
    if not 1 <= batch_size <= 1000:
        raise ValueError("batch_size must be between 1 and 1000")
    after = ""
    while True:
        with db.session() as s:
            ids = list(
                s.scalars(
                    select(Job.id)
                    .where(
                        Job.status == "COMPLETED",
                        Job.id > after,
                        pending_index(),
                    )
                    .order_by(Job.id)
                    .limit(batch_size)
                )
            )
        if not ids:
            return
        for job_id in ids:
            with db.session.begin() as s:
                job = s.scalar(select(Job).where(Job.id == job_id).with_for_update())
                if job is not None:
                    index_job_findings(s, job)
                    complete = job.finding_index_version == INDEX_VERSION
                else:
                    complete = False
            after = job_id
            yield int(complete)
