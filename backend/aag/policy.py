import hashlib
import json
import re

RULES = [
    (
        "prompt.override",
        "high",
        "prompt",
        r"(?i)ignore (?:all |any )?(?:previous|prior|system) instructions",
        "Instruction override",
        "Remove instructions that override the host's safety or authority boundaries.",
    ),
    (
        "exec.remote",
        "critical",
        "process",
        r"(?i)(?:curl|wget)[^\n]{0,300}\|\s*(?:sh|bash|zsh)",
        "Remote code execution pipeline",
        "Pin and verify artifacts; do not pipe network responses into a shell.",
    ),
    (
        "secret.private-key",
        "critical",
        "secrets",
        r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
        "Private key material",
        "Remove and rotate the exposed credential.",
    ),
    (
        "filesystem.destructive",
        "high",
        "filesystem",
        r"\brm\s+-(?:rf|fr)\s+[/~]",
        "Destructive filesystem operation",
        "Limit operations to an explicit workspace and require approval.",
    ),
    (
        "process.shell",
        "medium",
        "process",
        r"(?:shell\s*=\s*True|os\.system\s*\(|child_process|subprocess\.(?:run|Popen))",
        "Process execution capability",
        "Review input validation, executable allowlists and sandboxing.",
    ),
    (
        "network.egress",
        "low",
        "network",
        r"(?:requests\.(?:post|put)|fetch\s*\(|httpx\.(?:post|put)|urllib\.request)",
        "Outbound network capability",
        "Verify destinations and data minimization.",
    ),
    (
        "secret.environment",
        "medium",
        "secrets",
        r"(?:os\.environ|process\.env|\.ssh/|\.aws/credentials)",
        "Credential or environment access",
        "Restrict access to explicit variables and avoid transmitting secrets.",
    ),
]


def finding(
    engine,
    rule,
    severity,
    title,
    path="",
    line=None,
    evidence="",
    action="security",
    remediation="",
):
    identity = json.dumps([engine, rule, path, line, title], separators=(",", ":"))
    return {
        "fingerprint": hashlib.sha256(identity.encode()).hexdigest(),
        "engine": engine,
        "rule": rule,
        "severity": severity.lower(),
        "title": title,
        "path": path,
        "line": line,
        "evidence": evidence,
        "action": action,
        "remediation": remediation,
        "suppressed": False,
    }


def builtin_scan(files, root):
    findings = []
    scanned = 0
    skipped = []
    for path in files:
        if path.stat().st_size > 1_000_000:
            skipped.append(str(path.relative_to(root)))
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except (UnicodeError, OSError):
            skipped.append(str(path.relative_to(root)))
            continue
        scanned += 1
        for number, line in enumerate(content.splitlines(), 1):
            for rule, severity, action, pattern, title, remediation in RULES:
                if re.search(pattern, line):
                    # Never store arbitrary source lines, which can contain credentials.
                    findings.append(
                        finding(
                            "builtin",
                            rule,
                            severity,
                            title,
                            str(path.relative_to(root)),
                            number,
                            f"Matched {rule}; source text withheld",
                            action,
                            remediation,
                        )
                    )
                    if len(findings) >= 1000:
                        return findings, {
                            "files_scanned": scanned,
                            "skipped": skipped,
                            "truncated": True,
                        }
    return findings, {"files_scanned": scanned, "skipped": skipped, "truncated": False}


def decide(findings, engines):
    active = [f for f in findings if not f.get("suppressed")]
    if any(f["severity"] in {"critical", "high"} for f in active):
        return "BLOCK"
    if any(e["required"] and e["status"] != "completed" for e in engines):
        return "REVIEW"
    if any(f["severity"] in {"medium", "unknown"} for f in active):
        return "REVIEW"
    return "ALLOW"
