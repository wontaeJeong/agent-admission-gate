export type ListResource = "jobs" | "reviews" | "search";
export type ListState = {
  accountId: string;
  resource: ListResource;
  list_url: string;
  scroll_y: number;
};
export type ViewFilters = { version: number; [key: string]: string | number };
const keys: Record<ListResource, string[]> = {
  search: ["q", "type", "scope", "cursor"],
  jobs: ["scope", "days", "status", "verdict", "q", "mine"],
  reviews: ["tab", "status", "stage", "assignee", "q", "sort"],
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
      (resource === "search"
        ? keys[resource]
        : [...keys[resource], "page"]
      ).includes(key),
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

const entryIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type ListEntry = ListState & { entryId: string };
const entriesKey = (accountId: string, resource: ListResource) =>
  `aag-list-entries:${accountId}:${resource}`;
function listEntries(accountId: string, resource: ListResource): ListEntry[] {
  try {
    const stored = JSON.parse(
      sessionStorage.getItem(entriesKey(accountId, resource)) || "[]",
    );
    if (!Array.isArray(stored)) return [];
    return stored.flatMap((value) => {
      const state = validListState(value, accountId, resource);
      return state &&
        typeof value.entryId === "string" &&
        entryIdPattern.test(value.entryId)
        ? [
            {
              accountId,
              resource,
              entryId: value.entryId,
              list_url: state.list_url,
              scroll_y: state.scroll_y,
            },
          ]
        : [];
    });
  } catch {
    return [];
  }
}
/** The history state contains only an opaque UUID; URLs live in validated tab storage. */
export function currentListEntryId(): string | null {
  try {
    const stored = history.state?.aagListEntryId;
    if (typeof stored === "string" && entryIdPattern.test(stored))
      return stored;
    const entryId = crypto.randomUUID();
    history.replaceState({ ...history.state, aagListEntryId: entryId }, "");
    return entryId;
  } catch {
    return null;
  }
}
export function rememberListEntry(
  accountId: string,
  resource: ListResource,
  entryId: string | null,
  url: string,
  scrollY: number,
) {
  const state = validListState(
    { accountId, resource, list_url: url, scroll_y: scrollY },
    accountId,
    resource,
  );
  if (!state || !entryId || !entryIdPattern.test(entryId)) return;
  const entries = listEntries(accountId, resource).filter(
    (entry) => entry.entryId !== entryId,
  );
  entries.push({ ...state, entryId });
  try {
    sessionStorage.setItem(
      entriesKey(accountId, resource),
      JSON.stringify(entries),
    );
  } catch {
    /* Router state remains available if tab storage is blocked. */
  }
}
export function restoreListEntry(
  accountId: string,
  resource: ListResource,
  entryId: string | null,
  url: string,
): ListState | null {
  if (!entryId || !entryIdPattern.test(entryId) || !validURL(resource, url))
    return null;
  const entry = listEntries(accountId, resource).find(
    (entry) => entry.entryId === entryId && entry.list_url === url,
  );
  return entry
    ? {
        accountId,
        resource,
        list_url: entry.list_url,
        scroll_y: entry.scroll_y,
      }
    : null;
}
