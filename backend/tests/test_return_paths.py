"""Return targets must preserve known view state without carrying credentials."""

import pytest


def test_safe_return_path_preserves_finding_query():
    from aag.return_paths import normalize_return_to

    assert normalize_return_to("/jobs/job-1?tab=findings&finding=abc&occurrence=2") == (
        "/jobs/job-1?tab=findings&finding=abc&occurrence=2"
    )
    assert normalize_return_to("/jobs?scope=personal&page=3&token=secret&password=x") == (
        "/jobs?scope=personal&page=3"
    )


@pytest.mark.parametrize(
    "value",
    [
        None,
        "",
        "//evil.test",
        "%2f%2fevil.test",
        "/%252fevil.test",
        "/jobs/../admin",
        "/jobs/%2e%2e/admin",
        "/jobs\\evil",
        "/jobs\n",
        "https://evil.test/jobs",
        "/api",
        "/api/auth/login",
        "/health",
        "/mcp",
        "/sso/callback",
        "/login",
        "/unknown",
        "/" + "a" * 2048,
    ],
)
def test_unsafe_return_path_falls_back(value):
    from aag.return_paths import normalize_return_to

    assert normalize_return_to(value) == "/"


@pytest.mark.parametrize(
    "value",
    [
        "/new?from=j&mode=snapshot",
        "/jobs/j/summary",
        "/jobs/j/compare?baseline=b",
        "/search?q=CVE-2026&type=findings",
    ],
)
def test_planned_routes_are_allowed(value):
    from aag.return_paths import normalize_return_to

    assert normalize_return_to(value) == value


@pytest.mark.parametrize(
    "value",
    [
        "/notifications/open/n-1",
        "/notifications?view=settings",
        "/reviews?tab=mine&page=3",
        "/jobs?mine=true&page=3",
    ],
)
def test_current_navigation_state_survives_login(value):
    from aag.return_paths import normalize_return_to

    assert normalize_return_to(value) == value


def test_normalized_destination_fits_storage_limit():
    from aag.return_paths import normalize_return_to

    assert normalize_return_to("/jobs?q=" + "가" * 300) == "/"


def test_history_filters_only_survive_on_history_tab():
    from aag.return_paths import normalize_return_to

    path = "/jobs/j?tab=history&ref=release&profile=full&status=COMPLETED&page=2&page_size=25"
    assert normalize_return_to(path + "&token=secret") == path
    assert normalize_return_to("/jobs/j?tab=meta&ref=release&page=2") == "/jobs/j?tab=meta"
    assert (
        normalize_return_to("/jobs/j?tab=history&profile=invalid&status=NO&page=0&page_size=101")
        == "/jobs/j?tab=history"
    )
