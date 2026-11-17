"""Read-only comparison of stored evidence; absence never proves remediation."""

from collections import defaultdict
from urllib.parse import urlsplit

from fastapi import HTTPException

from .sources import validate_git_url

CLASSIFICATIONS = ("persisting", "moved_candidate", "new", "not_observed", "unmatched")
FINDING_FIELDS = (
    "fingerprint",
    "engine",
    "rule",
    "severity",
    "title",
    "path",
    "line",
    "suppressed",
)


def text_or_none(value):
    return value if isinstance(value, str) and value else None


def metadata(job):
    result = job.result if isinstance(job.result, dict) else {}
    engines = result.get("engines")
    engines = engines if isinstance(engines, list) else []
    projected = [
        {
            "name": text_or_none(e.get("name")),
            "status": text_or_none(e.get("status")),
            "required": e.get("required") if isinstance(e.get("required"), bool) else None,
            "engine_version": text_or_none(e.get("engine_version")),
            "database_version": text_or_none(e.get("database_version")),
        }
        for e in engines
        if isinstance(e, dict)
    ]
    return {
        **{
            key: getattr(job, key)
            for key in (
                "id",
                "source",
                "source_type",
                "ref",
                "resolved_commit",
                "target_commit",
                "profile",
                "status",
                "verdict",
                "effective_verdict",
                "content_hash",
                "created_at",
            )
        },
        "policy_version": text_or_none(result.get("policy_version")),
        "scanner_revision": text_or_none(result.get("scanner_revision")),
        "engines": projected,
        "coverage_complete": (
            job.status == "COMPLETED"
            and result.get("coverage_complete") is True
            and isinstance(result.get("findings"), list)
            and all(isinstance(f, dict) for f in result["findings"])
            and bool(projected)
            and len(projected) == len(engines)
            and all(
                e["required"] is not None and (not e["required"] or e["status"] == "completed")
                for e in projected
            )
            and not any(e.get("truncated") or e.get("skipped") for e in engines)
        ),
    }


def known_equal(a, b):
    return a == b if a is not None and b is not None else None


def stored_findings(job):
    result = job.result if isinstance(job.result, dict) else {}
    findings = result.get("findings")
    if not isinstance(findings, list):
        return []
    return [
        {
            key: (value if isinstance(value := f.get(key), (str, int, bool)) else None)
            for key in FINDING_FIELDS
        }
        for f in findings
        if isinstance(f, dict)
    ]


def compare_jobs(baseline, current, *, allow_unlinked=False) -> dict:
    """Caller must authorize BOTH jobs before invoking this pure projection."""
    if baseline.id == current.id:
        raise HTTPException(422, "Select two different scans")
    if baseline.owner_id != current.owner_id or baseline.source_type != current.source_type:
        raise HTTPException(422, "Scan owner or source type differs")
    if baseline.source_type == "git":
        try:
            identities = [
                validate_git_url(j.source, [urlsplit(j.source).hostname], resolve=False)
                for j in (baseline, current)
            ]
        except ValueError:
            raise HTTPException(422, "Repository identity is unavailable") from None
        if identities[0] != identities[1]:
            raise HTTPException(422, "Scan repository differs")
        same_source = True
    elif baseline.source_type == "upload":
        same_source = (baseline.lineage_root_id or baseline.id) == (
            current.lineage_root_id or current.id
        )
        if not same_source and not allow_unlinked:
            raise HTTPException(
                422,
                {
                    "code": "unlinked_zip",
                    "message": "Unlinked ZIP uploads require explicit confirmation",
                },
            )
    else:
        raise HTTPException(422, "Source identity is unavailable")
    if any(j.status not in {"COMPLETED", "FAILED", "CANCELLED"} for j in (baseline, current)):
        raise HTTPException(409, "Both scans must finish before comparison")
    old, new = metadata(baseline), metadata(current)
    same_engines = [(e["name"], e["required"]) for e in old["engines"]] == [
        (e["name"], e["required"]) for e in new["engines"]
    ]
    comparability = {
        "same_source": same_source,
        "same_profile": old["profile"] == new["profile"],
        "same_policy": known_equal(old["policy_version"], new["policy_version"]),
        "same_scanner_revision": known_equal(old["scanner_revision"], new["scanner_revision"]),
        "coverage_complete": old["coverage_complete"] and new["coverage_complete"] and same_engines,
        "provenance_known": bool(old["engines"] and new["engines"])
        and all(
            e["engine_version"] is not None and e["database_version"] is not None
            for e in old["engines"] + new["engines"]
        ),
    }
    response = {
        "baseline": old,
        "current": new,
        "comparability": comparability,
        "summary": None,
        "items": [],
    }
    if baseline.status != "COMPLETED" or current.status != "COMPLETED":
        return response
    items = response["items"]

    def add(classification, before=None, after=None):
        flags = []
        if before is not None and after is not None:
            if before["severity"] != after["severity"]:
                flags.append("severity_changed")
            if before["suppressed"] != after["suppressed"]:
                flags.append("suppression_changed")
        items.append(
            {
                "classification": classification,
                "baseline_finding": before,
                "current_finding": after,
                "change_flags": flags,
                "confidence": "exact"
                if classification == "persisting"
                else "candidate"
                if classification == "moved_candidate"
                else "unmatched",
            }
        )

    groups = [defaultdict(list), defaultdict(list)]
    for index, job in enumerate((baseline, current)):
        for f in stored_findings(job):
            if not text_or_none(f["fingerprint"]):
                add("unmatched", f if index == 0 else None, f if index == 1 else None)
            else:
                groups[index][f["fingerprint"]].append(f)
    remaining = [[], []]
    for fingerprint in dict.fromkeys([*groups[0], *groups[1]]):
        left, right = groups[0][fingerprint], groups[1][fingerprint]
        paired = min(len(left), len(right))
        for before, after in zip(left[:paired], right[:paired]):
            add("persisting", before, after)
        remaining[0].extend(left[paired:])
        remaining[1].extend(right[paired:])
    candidates = [defaultdict(list), defaultdict(list)]
    for index, rows in enumerate(remaining):
        for f in rows:
            key = tuple(f[k] for k in ("engine", "rule", "path", "title"))
            if any(not isinstance(v, str) for v in key):
                add("unmatched", f if index == 0 else None, f if index == 1 else None)
            else:
                candidates[index][key].append(f)
    for key in dict.fromkeys([*candidates[0], *candidates[1]]):
        left, right = candidates[0][key], candidates[1][key]
        if len(left) == len(right) == 1:
            add("moved_candidate", left[0], right[0])
        else:
            ambiguous = len(left) > 1 or len(right) > 1
            for f in left:
                add("unmatched" if ambiguous else "not_observed", f)
            for f in right:
                add("unmatched" if ambiguous else "new", None, f)
    response["summary"] = {kind: 0 for kind in CLASSIFICATIONS}
    for item in items:
        response["summary"][item["classification"]] += 1
    return response
