import json
import shutil
import time

from .policy import finding
from .sources import command


class ScannerContractError(ValueError):
    pass


def normalize(engine, payload):
    """Reject unknown envelopes: a successful process exit alone is not a clean scan."""
    findings = []
    if not isinstance(payload, dict):
        raise ScannerContractError("Expected JSON object")
    if engine == "syft":
        if not isinstance(payload.get("artifacts"), list):
            raise ScannerContractError("Missing SBOM artifacts")
        for package in payload["artifacts"]:
            licenses = package.get("licenses", [])
            expressions = [x.get("spdxExpression", x.get("value", "")) for x in licenses]
            if not expressions or any(x in {"", "UNKNOWN", "NOASSERTION"} for x in expressions):
                findings.append(
                    finding(
                        engine,
                        "license.unknown",
                        "medium",
                        f"Unknown license: {package.get('name', 'package')}",
                        action="license",
                        remediation="Review license evidence before admission.",
                    )
                )
            elif any(" OR " in x or " AND " in x for x in expressions):
                findings.append(
                    finding(
                        engine,
                        "license.expression",
                        "medium",
                        f"License expression requires review: {package.get('name', 'package')}",
                        action="license",
                        evidence="; ".join(expressions),
                    )
                )
        return findings
    if engine == "grype":
        if not isinstance(payload.get("matches"), list):
            raise ScannerContractError("Missing vulnerability matches")
        if payload.get("descriptor", {}).get("db", {}).get("error"):
            raise ScannerContractError("Vulnerability database is unavailable")
        for match in payload["matches"]:
            v, p = match["vulnerability"], match["artifact"]
            findings.append(
                finding(
                    engine,
                    v["id"],
                    v.get("severity", "unknown"),
                    f"{v['id']} in {p.get('name')}@{p.get('version')}",
                    action="vulnerability",
                    remediation="Fixed versions: "
                    + ", ".join(v.get("fix", {}).get("versions", [])),
                )
            )
        return findings
    if engine == "osv":
        if not isinstance(payload.get("results"), list):
            raise ScannerContractError("Missing OSV results")
        for source in payload["results"]:
            for package in source.get("packages", []):
                for v in package.get("vulnerabilities", []):
                    findings.append(
                        finding(
                            engine,
                            v["id"],
                            "unknown",
                            v.get("summary", v["id"]),
                            path=source.get("source", {}).get("path", ""),
                            action="vulnerability",
                        )
                    )
        return findings
    if engine == "grant":
        targets = payload.get("run", {}).get("targets")
        if not isinstance(targets, list) or not targets:
            raise ScannerContractError("Missing Grant target evaluation")
        for target in targets:
            evaluation = target["evaluation"]
            if evaluation.get("status") not in {"compliant", "noncompliant"}:
                raise ScannerContractError("License policy evaluation incomplete")
            for package in evaluation["findings"]["packages"]:
                if package.get("decision") != "allow":
                    findings.append(
                        finding(
                            engine,
                            "license." + str(package.get("decision", "unknown")),
                            "medium",
                            "License review: " + package["name"],
                            action="license",
                            evidence=", ".join(x["id"] for x in package.get("licenses", [])),
                        )
                    )
        return findings
    if engine == "skill":
        if not isinstance(payload.get("findings"), list) or not isinstance(
            payload.get("is_safe"), bool
        ):
            raise ScannerContractError("Missing Skill Scanner result")
        if payload.get("errors") or payload.get("scan_metadata", {}).get("errors"):
            raise ScannerContractError("Skill analyzer error")
        rows = payload["findings"]
        if not payload["is_safe"] and not rows:
            raise ScannerContractError("Unsafe result without findings")
    elif engine == "mcp":
        if not isinstance(payload.get("scan_results"), list) or not payload["scan_results"]:
            raise ScannerContractError("Missing MCP scan results")
        if payload.get("errors") or payload.get("analyzer_errors"):
            raise ScannerContractError("MCP analyzer error")
        rows = []
        for item in payload["scan_results"]:
            if (
                item.get("status") != "completed"
                or not isinstance(item.get("is_safe"), bool)
                or item.get("errors")
                or item.get("analyzer_errors")
                or not isinstance(item.get("findings"), dict)
                or not item["findings"]
            ):
                raise ScannerContractError("MCP analysis incomplete")
            item_rows = []
            for name, analyzer in item["findings"].items():
                if isinstance(analyzer, list):
                    item_rows.extend(analyzer)
                elif isinstance(analyzer, dict):
                    if analyzer.get("errors") or analyzer.get("status") in {
                        "error",
                        "partial",
                        "failed",
                    }:
                        raise ScannerContractError("MCP analyzer incomplete")
                    if "total_findings" in analyzer:
                        if (
                            type(analyzer["total_findings"]) is not int
                            or analyzer["total_findings"] < 0
                        ):
                            raise ScannerContractError("Invalid MCP finding count")
                        if (
                            analyzer["total_findings"]
                            or str(analyzer.get("severity", "unknown")).lower() != "safe"
                        ):
                            item_rows.append(
                                {
                                    "rule_id": "mcp." + name,
                                    "severity": analyzer.get("severity", "unknown"),
                                    "title": analyzer.get("threat_summary", "MCP metadata finding"),
                                    "category": "mcp_metadata",
                                    "file_path": item.get("tool_name", item.get("item_name", "")),
                                }
                            )
                    elif isinstance(analyzer.get("findings", analyzer.get("threats")), list):
                        item_rows.extend(analyzer.get("findings", analyzer.get("threats")))
                    else:
                        raise ScannerContractError("Unsupported MCP analyzer result")
                else:
                    raise ScannerContractError("Unsupported MCP analyzer result")
            if not item["is_safe"] and not item_rows:
                item_rows.append(
                    {"rule_id": "mcp.unsafe", "severity": "unknown", "title": "Unsafe MCP metadata"}
                )
            rows.extend(item_rows)
    else:
        raise ScannerContractError("Unsupported engine contract")
    for row in rows:
        findings.append(
            finding(
                engine,
                row.get("rule_id", row.get("id", "scanner.finding")),
                str(row.get("severity", "unknown")),
                str(row.get("title", row.get("description", "Scanner finding")))[:500],
                path=str(row.get("file_path", "")),
                line=row.get("line_number"),
                action=row.get("category", "security"),
                remediation=str(row.get("remediation", ""))[:2000],
            )
        )
    return findings


async def external(engine, argv, work, settings, required=True):
    start = time.time()
    result = {
        "name": engine,
        "status": "unavailable",
        "required": required,
        "started_at": start,
        "exit_code": None,
    }
    findings, payload = [], None
    if not shutil.which(argv[0]):
        result["error"] = f"{argv[0]} is not installed"
    else:
        try:
            env = {}
            if engine == "grype":
                env["GRYPE_DB_AUTO_UPDATE"] = str(settings.grype_db_auto_update).lower()
                if settings.grype_db_cache_dir:
                    env["GRYPE_DB_CACHE_DIR"] = settings.grype_db_cache_dir
            code, out, _ = await command(argv, cwd=work, timeout=settings.scan_timeout, env=env)
            result["exit_code"] = code
            if code not in (0, 1):
                raise ScannerContractError("Scanner process failed")
            payload = json.loads(out)
            findings = normalize(engine, payload)
            if code != 0 and not findings:
                raise ScannerContractError("Nonzero exit without findings")
            result["status"] = "completed"
            if engine == "syft":
                result["packages"] = len(payload["artifacts"])
            if engine == "grype":
                result["database"] = payload.get("descriptor", {}).get("db", {})
        except TimeoutError:
            result.update(status="timeout", error="Scanner timed out")
        except Exception:
            result.update(
                status="failed",
                error="Scanner failed or returned an unsupported result; check pinned engine version",
            )
    result["duration_ms"] = (time.time() - start) * 1000
    return result, findings, payload
