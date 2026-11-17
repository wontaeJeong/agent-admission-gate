export type ListResource = "jobs" | "reviews";
export type ListState = {
  accountId: string;
  resource: ListResource;
  list_url: string;
  scroll_y: number;
};
export type ViewFilters = { version: number; [key: string]: string | number };
const keys: Record<ListResource, string[]> = {
  jobs: ["scope", "days", "status", "verdict", "q", "mine"],
  reviews: ["tab", "status"],
};
function validURL(resource: ListResource, value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    /[\\#\r\n]/.test(value)
  )
    return false;
  const boundary = value.indexOf("?");
  const path = boundary < 0 ? value : value.slice(0, boundary);
  const query = boundary < 0 ? "" : value.slice(boundary + 1);
  return (
    path === "/" + resource &&
    [...new URLSearchParams(query).keys()].every((key) =>
      [...keys[resource], "page"].includes(key),
    )
  );
}
export function validListState(
  value: unknown,
  accountId: string,
  resource: ListResource,
): ListState | null {
  if (!value || typeof value !== "object") return null;
  const v = value as ListState;
  return v.accountId === accountId &&
    v.resource === resource &&
    validURL(resource, v.list_url) &&
    Number.isFinite(v.scroll_y) &&
    v.scroll_y >= 0
    ? v
    : null;
}
const key = (accountId: string, resource: ListResource) =>
  `aag-list:${accountId}:${resource}`;
export function rememberList(
  accountId: string,
  resource: ListResource,
  url: string,
  scrollY: number,
) {
  const state = validListState(
    { accountId, resource, list_url: url, scroll_y: scrollY },
    accountId,
    resource,
  );
  if (!state) return;
  try {
    sessionStorage.setItem(key(accountId, resource), JSON.stringify(state));
  } catch {
    /* Navigation still carries the in-memory state. */
  }
}
export function restoreList(
  accountId: string,
  resource: ListResource,
): ListState | null {
  try {
    return validListState(
      JSON.parse(sessionStorage.getItem(key(accountId, resource)) || "null"),
      accountId,
      resource,
    );
  } catch {
    return null;
  }
}
export function filtersFromSearch(
  resource: ListResource,
  params: URLSearchParams,
): ViewFilters {
  const filters: ViewFilters = { version: 1 };
  for (const k of keys[resource]) {
    const value = params.get(k);
    if (value) filters[k] = k === "days" ? Number(value) : value;
  }
  return filters;
}
export function filtersToSearch(filters: ViewFilters): URLSearchParams {
  return new URLSearchParams(
    Object.entries(filters)
      .filter(([key]) => key !== "version")
      .map(([key, value]) => [key, String(value)]),
  );
}
