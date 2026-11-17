"""A narrow, shared-with-SPA allowlist for post-authentication destinations."""

import re
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit

_ROUTES = (
    (r"/", {"scope", "days", "tab"}),
    (r"/jobs", {"scope", "mine", "days", "status", "verdict", "q", "page", "profile", "ref"}),
    (r"/jobs/[A-Za-z0-9_-]+", {"tab", "severity", "engine", "q", "finding", "occurrence"}),
    (r"/jobs/[A-Za-z0-9_-]+/summary", set()),
    (r"/jobs/[A-Za-z0-9_-]+/compare", {"baseline"}),
    (r"/new", {"from", "mode"}),
    (r"/reviews", {"tab", "status", "workflow", "scope", "q", "page", "assignee", "stage", "sort"}),
    (r"/reviews/[A-Za-z0-9_-]+", {"tab"}),
    (r"/boards", {"kind", "q", "page"}),
    (r"/boards/[A-Za-z0-9_-]+", set()),
    (r"/api-keys", {"key"}),
    (r"/admin", {"tab", "exception", "key", "q", "page"}),
    (r"/notifications", {"view", "tab", "category", "page"}),
    (r"/notifications/open/[A-Za-z0-9_-]+", set()),
    (r"/search", {"q", "type", "scope", "cursor"}),
    (r"/(?:about|guide|device-clients|settings|coverage)", set()),
)


def normalize_return_to(value: str | None) -> str:
    if not value or len(value) > 2048 or not value.startswith("/"):
        return "/"
    try:
        decoded = unquote(value, errors="strict")
        if any(ord(c) < 32 or ord(c) == 127 for c in decoded) or "\\" in decoded:
            return "/"
        if "%" in decoded or decoded.startswith("//"):
            return "/"
        parsed = urlsplit(value)
        if parsed.scheme or parsed.netloc or unquote(parsed.path) != parsed.path:
            return "/"
        for pattern, allowed in _ROUTES:
            if re.fullmatch(pattern, parsed.path):
                pairs = parse_qsl(parsed.query)
                history = re.fullmatch(r"/jobs/[A-Za-z0-9_-]+", parsed.path) and [
                    v for k, v in pairs if k == "tab"
                ] == ["history"]
                query = urlencode(
                    [
                        (k, v)
                        for k, v in pairs
                        if k in allowed or (history and _history_filter(k, v))
                    ]
                )
                target = parsed.path + ("?" + query if query else "")
                return target if len(target) <= 2048 else "/"
    except (ValueError, UnicodeError):
        pass
    return "/"


def _history_filter(key, value):
    if key == "ref":
        return len(value) <= 200
    if key == "profile":
        return value in {"static", "full"}
    if key == "status":
        return value in {"PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"}
    if key in {"page", "page_size"} and re.fullmatch(r"[1-9][0-9]{0,8}", value):
        return key == "page" or int(value) <= 100
    return False
