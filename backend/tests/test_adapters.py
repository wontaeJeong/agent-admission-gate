import json
import time
from types import SimpleNamespace

import httpx
import pytest
from aag import llm
from aag.models import Usage
from aag.scanners import normalize
from sqlalchemy import select


def test_native_scanner_contracts():
    grype = normalize(
        "grype",
        {
            "matches": [
                {
                    "vulnerability": {
                        "id": "CVE-EXAMPLE",
                        "severity": "High",
                        "fix": {"versions": ["2"]},
                    },
                    "artifact": {"name": "pkg", "version": "1"},
                }
            ]
        },
    )
    assert grype[0]["severity"] == "high"
    grant = normalize(
        "grant",
        {
            "run": {
                "targets": [
                    {
                        "evaluation": {
                            "status": "noncompliant",
                            "findings": {
                                "packages": [
                                    {
                                        "name": "pkg",
                                        "decision": "deny",
                                        "licenses": [{"id": "UNKNOWN"}],
                                    }
                                ]
                            },
                        }
                    }
                ]
            }
        },
    )
    assert grant[0]["action"] == "license"
    skill = normalize(
        "skill",
        {
            "is_safe": False,
            "findings": [
                {
                    "rule_id": "R1",
                    "severity": "HIGH",
                    "title": "Finding",
                    "file_path": "x.py",
                    "line_number": 2,
                }
            ],
        },
    )
    assert skill[0]["path"] == "x.py"
    mcp = normalize(
        "mcp",
        {
            "scan_results": [
                {
                    "status": "completed",
                    "is_safe": False,
                    "findings": {
                        "yara_analyzer": [{"severity": "HIGH", "title": "Tool poisoning"}]
                    },
                }
            ]
        },
    )
    assert mcp[0]["severity"] == "high"
    assert (
        normalize("syft", {"artifacts": [{"name": "pkg", "licenses": []}]})[0]["severity"]
        == "medium"
    )
    assert (
        normalize(
            "osv",
            {
                "results": [
                    {
                        "source": {"path": "lock"},
                        "packages": [{"vulnerabilities": [{"id": "OSV-TEST"}]}],
                    }
                ]
            },
        )[0]["action"]
        == "vulnerability"
    )


def mock_http(monkeypatch, callback):
    real = httpx.AsyncClient
    monkeypatch.setattr(
        llm.httpx,
        "AsyncClient",
        lambda **kw: real(transport=httpx.MockTransport(callback), trust_env=False, **kw),
    )


@pytest.mark.parametrize("provider", ["onprem", "systemone"])
async def test_model_usage_and_native_systemone(provider, app, client, monkeypatch):
    owner = client.get("/api/auth/me").json()["id"]
    settings = app.state.settings
    settings.llm_provider, settings.llm_model = provider, "test-model"
    settings.llm_base_url = "https://model.example.test/v1"

    def respond(request):
        body = json.loads(request.content)
        if provider == "systemone":
            assert request.url.path == "/v1/systemone" and "questions" in body
            return httpx.Response(
                200,
                json={
                    "model": "resolved-model",
                    "answers": {"needs_review": {"type": "noul", "noul": 0.73}},
                    "usage": {"input_tokens": 23, "output_tokens": 2},
                },
            )
        assert request.url.path == "/v1/chat/completions"
        return httpx.Response(
            200,
            json={
                "model": "resolved-model",
                "choices": [
                    {"message": {"content": '{"needs_review":true,"reason":"Review required"}'}}
                ],
                "usage": {
                    "prompt_tokens": 23,
                    "completion_tokens": 2,
                    "prompt_tokens_details": {"cached_tokens": 4},
                },
            },
        )

    mock_http(monkeypatch, respond)
    result = await llm.judge(
        settings, {"findings": []}, app.state.db, SimpleNamespace(owner_id=owner, id="j1")
    )
    assert result["needs_review"]
    if provider == "systemone":
        assert result["probability"] == 0.73 and result["answers"]["needs_review"]["noul"] == 0.73
    with app.state.db.session() as s:
        u = s.scalar(select(Usage).where(Usage.kind == "llm"))
        assert u.provider == provider and u.model == "resolved-model" and u.input_tokens == 23
        assert u.cost_usd is None and u.status == 200


async def test_model_failure_preserves_unknown_usage(app, client, monkeypatch):
    settings = app.state.settings
    settings.llm_provider, settings.llm_model = "onprem", "offline"
    owner = client.get("/api/auth/me").json()["id"]
    mock_http(monkeypatch, lambda req: httpx.Response(503, json={"error": "unavailable"}))
    with pytest.raises(httpx.HTTPStatusError):
        await llm.judge(settings, {}, app.state.db, SimpleNamespace(owner_id=owner, id="j2"))
    with app.state.db.session() as s:
        u = s.scalar(select(Usage).where(Usage.kind == "llm"))
        assert u.status == 503 and u.input_tokens is None


async def test_bedrock_converse_usage(app, client, monkeypatch):
    import boto3

    settings = app.state.settings
    settings.llm_provider, settings.llm_model = "bedrock", "bedrock-test-model"
    owner = client.get("/api/auth/me").json()["id"]

    class FakeBedrock:
        def converse(self, **request):
            assert request["modelId"] == "bedrock-test-model"
            return {
                "output": {
                    "message": {
                        "content": [
                            {"text": '{"needs_review":false,"reason":"No additional concerns"}'}
                        ]
                    }
                },
                "usage": {
                    "inputTokens": 10,
                    "outputTokens": 3,
                    "cacheReadInputTokens": 2,
                    "cacheWriteInputTokens": 1,
                },
            }

    monkeypatch.setattr(boto3, "client", lambda *a, **k: FakeBedrock())
    assert not (
        await llm.judge(settings, {}, app.state.db, SimpleNamespace(owner_id=owner, id="j3"))
    )["needs_review"]
    with app.state.db.session() as s:
        u = s.scalar(select(Usage).where(Usage.kind == "llm"))
        assert u.provider == "bedrock" and u.input_tokens == 10 and u.cache_write_tokens == 1


async def test_systemone_invalid_probability_rejected(app, client, monkeypatch):
    settings = app.state.settings
    settings.llm_provider, settings.llm_model = "systemone", "test"
    owner = client.get("/api/auth/me").json()["id"]
    mock_http(
        monkeypatch,
        lambda req: httpx.Response(
            200, json={"answers": {"needs_review": {"type": "noul", "noul": True}}}
        ),
    )
    with pytest.raises(ValueError):
        await llm.judge(settings, {}, app.state.db, SimpleNamespace(owner_id=owner, id="j4"))
    with app.state.db.session() as s:
        assert s.scalar(select(Usage).where(Usage.kind == "llm")).status == 502


def test_cancel_pending_scan(client, monkeypatch):
    import asyncio

    from conftest import upload, wait_job

    async def slow(*a, **kw):
        await asyncio.sleep(30)

    monkeypatch.setattr("aag.service.ScanService.scan", slow)
    j = upload(client)
    assert client.post("/api/scans/" + j + "/cancel").status_code == 200
    assert wait_job(client, j)["status"] == "CANCELLED"


def test_expired_api_key(client, app):
    from aag.models import APIKey

    key = client.post("/api/api-keys", json={"name": "expired"}).json()
    with app.state.db.session.begin() as s:
        s.get(APIKey, key["id"]).expires_at = time.time() - 1
    assert (
        client.get("/api/scans", headers={"Authorization": "Bearer " + key["token"]}).status_code
        == 401
    )


def test_mcp_transport_authorization_and_shared_store(client):
    key = client.post("/api/api-keys", json={"name": "mcp"}).json()["token"]
    headers = {"Authorization": "Bearer " + key, "Accept": "application/json, text/event-stream"}

    def message(method, params, ident=1):
        r = client.post(
            "/mcp/",
            headers=headers,
            json={"jsonrpc": "2.0", "id": ident, "method": method, "params": params},
        )
        assert r.status_code == 200, r.text
        if r.headers["content-type"].startswith("text/event-stream"):
            return json.loads(
                next(line[6:] for line in r.text.splitlines() if line.startswith("data: "))
            )
        return r.json()

    initialized = message(
        "initialize",
        {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "pytest", "version": "1"},
        },
    )
    assert "serverInfo" in initialized["result"]
    listed = message("tools/list", {}, 2)
    assert {"scan", "get_scan", "list_scans"} <= {x["name"] for x in listed["result"]["tools"]}
    result = message("tools/call", {"name": "list_scans", "arguments": {}}, 3)
    assert not result["result"].get("isError", False)
    denied = message("tools/call", {"name": "get_scan", "arguments": {"scan_id": "not-owned"}}, 4)
    assert denied["result"]["isError"]


def test_mcp_rolled_up_severity_and_incomplete_analyzers():
    from aag.scanners import ScannerContractError

    payload = {
        "scan_results": [
            {
                "status": "completed",
                "is_safe": False,
                "tool_name": "read",
                "findings": {
                    "yara_analyzer": {
                        "severity": "HIGH",
                        "threat_summary": "Tool poisoning",
                        "threat_names": ["PROMPT INJECTION"],
                        "total_findings": 2,
                    }
                },
            }
        ]
    }
    assert normalize("mcp", payload)[0]["severity"] == "high"
    payload["scan_results"][0]["is_safe"] = True
    payload["scan_results"][0]["findings"]["yara_analyzer"] = {
        "severity": "SAFE",
        "total_findings": 0,
    }
    assert normalize("mcp", payload) == []
    payload["scan_results"][0]["analyzer_errors"] = ["yara failed"]
    with pytest.raises(ScannerContractError):
        normalize("mcp", payload)
