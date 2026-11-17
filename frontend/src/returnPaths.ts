// Keep the route/query allowlist aligned with backend/aag/return_paths.py.
const routes: [RegExp, string[]][] = [
  [new RegExp("^/$"), ["days", "scope", "tab"]],
  [
    new RegExp("^/jobs$"),
    [
      "days",
      "page",
      "profile",
      "q",
      "ref",
      "mine",
      "scope",
      "status",
      "verdict",
    ],
  ],
  [
    new RegExp("^/jobs/[A-Za-z0-9_-]+$"),
    ["engine", "finding", "occurrence", "q", "severity", "tab"],
  ],
  [new RegExp("^/jobs/[A-Za-z0-9_-]+/summary$"), []],
  [new RegExp("^/jobs/[A-Za-z0-9_-]+/compare$"), ["baseline"]],
  [new RegExp("^/new$"), ["from", "mode"]],
  [
    new RegExp("^/reviews$"),
    [
      "assignee",
      "page",
      "q",
      "scope",
      "status",
      "tab",
      "workflow",
      "stage",
      "sort",
    ],
  ],
  [new RegExp("^/reviews/[A-Za-z0-9_-]+$"), ["tab"]],
  [new RegExp("^/boards$"), ["kind", "page", "q"]],
  [new RegExp("^/boards/[A-Za-z0-9_-]+$"), []],
  [new RegExp("^/api-keys$"), ["key"]],
  [new RegExp("^/admin$"), ["exception", "key", "page", "q", "tab"]],
  [new RegExp("^/notifications$"), ["category", "page", "tab", "view"]],
  [new RegExp("^/notifications/open/[A-Za-z0-9_-]+$"), []],
  [new RegExp("^/search$"), ["cursor", "q", "scope", "type"]],
  [new RegExp("^/(?:about|guide|device-clients|settings|coverage)$"), []],
];
export function normalizeReturnTo(value: string | null | undefined): string {
  if (!value || value.length > 2048 || !value.startsWith("/")) return "/";
  try {
    const decoded = decodeURIComponent(value);
    if (
      /[\\\x00-\x1f\x7f]/.test(decoded) ||
      decoded.includes("%") ||
      decoded.startsWith("//")
    )
      return "/";
    // Validate the raw path before URL parsing can collapse traversal segments.
    const path = value.split(/[?#]/, 1)[0];
    if (decodeURIComponent(path) !== path) return "/";
    const route = routes.find(([pattern]) => pattern.test(path));
    if (!route) return "/";
    const parsed = new URL(value, "https://return.example.test");
    const query = new URLSearchParams();
    const history =
      /^\/jobs\/[A-Za-z0-9_-]+$/.test(path) &&
      parsed.searchParams.getAll("tab").length === 1 &&
      parsed.searchParams.get("tab") === "history";
    for (const [key, val] of parsed.searchParams) {
      if (
        (route[1].includes(key) || (history && historyFilter(key, val))) &&
        val
      )
        query.append(key, val);
    }
    const target = path + (query.size ? "?" + query.toString() : "");
    return target.length <= 2048 ? target : "/";
  } catch {
    return "/";
  }
}

function historyFilter(key: string, value: string): boolean {
  if (key === "ref") return value.length <= 200;
  if (key === "profile") return ["static", "full"].includes(value);
  if (key === "status")
    return ["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"].includes(
      value,
    );
  if (["page", "page_size"].includes(key) && /^[1-9][0-9]{0,8}$/.test(value))
    return key === "page" || Number(value) <= 100;
  return false;
}
