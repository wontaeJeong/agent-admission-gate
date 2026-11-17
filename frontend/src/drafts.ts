export type DraftKind =
  | "scan_new"
  | "review_request"
  | "review_decision"
  | "review_release"
  | "review_changes"
  | "review_respond"
  | "review_withdraw"
  | "review_followup"
  | "scan_comment"
  | "board_post";
export type DraftFields = Record<string, string | boolean>;
export type DraftState = {
  status?: string | null;
  decided_at?: string | null;
  review_id?: string | null;
};
export type DraftEnvelope<T = Record<string, unknown>> = {
  schema_version: number;
  account_id: string;
  kind: DraftKind;
  target_id: string;
  base_revision: number | null;
  base_state: DraftState;
  saved_at: number;
  fields: T;
};
export class DraftSchemaError extends Error {}
const prefix = "aag-draft:";
const ttl = 86_400_000;
const maxBytes = 262_144;
const allowlists: Record<DraftKind, Record<string, "string" | "boolean">> = {
  scan_new: {
    type: "string",
    url: "string",
    ref: "string",
    profile: "string",
    force: "boolean",
  },
  review_request: { reason: "string" },
  review_release: { reason: "string" },
  review_changes: { reason: "string" },
  review_respond: { reason: "string" },
  review_withdraw: { reason: "string" },
  review_followup: { reason: "string" },
  review_decision: { decision: "string", reason: "string" },
  scan_comment: { body: "string", internal: "boolean" },
  board_post: {
    title: "string",
    body: "string",
    visibility: "string",
    status: "string",
    pinned: "boolean",
  },
};
export const draftKey = (account: string, kind: DraftKind, target: string) =>
  `${prefix}${JSON.stringify([account, kind, target])}`;
export function allowedDraftFields(
  kind: DraftKind,
  fields: Record<string, unknown>,
): DraftFields {
  const safe: DraftFields = {};
  for (const [name, type] of Object.entries(allowlists[kind])) {
    const value = fields[name];
    if (typeof value !== type) continue;
    // Repository URLs are not a credential channel. Query/fragment values are not stored.
    if (name === "url" && value) {
      try {
        const url = new URL(String(value));
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          continue;
      } catch {
        continue;
      }
    }
    safe[name] = value as string | boolean;
  }
  return safe;
}
function keys(storage: Storage) {
  return Array.from({ length: storage.length }, (_, i) =>
    storage.key(i),
  ).filter((key): key is string => !!key?.startsWith(prefix));
}
function validate(
  key: string,
  value: DraftEnvelope,
): DraftEnvelope<DraftFields> {
  if (
    !value ||
    value.schema_version !== 1 ||
    !Object.hasOwn(allowlists, value.kind) ||
    typeof value.account_id !== "string" ||
    typeof value.target_id !== "string" ||
    key !== draftKey(value.account_id, value.kind, value.target_id) ||
    !Number.isFinite(value.saved_at) ||
    !(value.base_revision === null || Number.isInteger(value.base_revision)) ||
    !value.fields ||
    typeof value.fields !== "object" ||
    !value.base_state ||
    typeof value.base_state !== "object"
  )
    throw new DraftSchemaError(
      "Draft schema is unavailable; discard this draft to continue.",
    );
  const base_state: DraftState = {};
  for (const name of ["status", "decided_at", "review_id"] as const) {
    const field = value.base_state[name];
    if (field === null || typeof field === "string") base_state[name] = field;
  }
  return {
    schema_version: 1,
    account_id: value.account_id,
    kind: value.kind,
    target_id: value.target_id,
    base_revision: value.base_revision,
    base_state,
    saved_at: value.saved_at,
    fields: allowedDraftFields(value.kind, value.fields),
  };
}
export function readDraft(
  key: string,
  now: number,
  storage: Storage = sessionStorage,
): DraftEnvelope<DraftFields> | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  let decoded: DraftEnvelope;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new DraftSchemaError(
      "Draft format is unavailable; discard this draft to continue.",
    );
  }
  const value = validate(key, decoded);
  if (now - value.saved_at >= ttl || value.saved_at > now) {
    storage.removeItem(key);
    return null;
  }
  return value;
}
export function writeDraft(
  key: string,
  value: DraftEnvelope,
  now: number,
  storage: Storage = sessionStorage,
) {
  const serialized = JSON.stringify(validate(key, { ...value, saved_at: now }));
  const bytes = (key: string, value: string) =>
    new TextEncoder().encode(key + value).length;
  if (bytes(key, serialized) > maxBytes)
    throw new Error("Draft exceeds the 256 KiB storage limit.");
  const entries = keys(storage)
    .filter((item) => item !== key)
    .map((item) => {
      const raw = storage.getItem(item) || "";
      let saved = 0;
      try {
        saved = JSON.parse(raw).saved_at || 0;
      } catch {
        /* Invalid envelopes are oldest. */
      }
      return { key: item, raw, saved };
    })
    .sort((a, b) => a.saved - b.saved);
  let size =
    bytes(key, serialized) +
    entries.reduce((sum, item) => sum + bytes(item.key, item.raw), 0);
  const remove: string[] = [];
  while (
    entries.length &&
    (entries.length >= 20 || size > maxBytes || now - entries[0].saved >= ttl)
  ) {
    const oldest = entries.shift()!;
    remove.push(oldest.key);
    size -= bytes(oldest.key, oldest.raw);
  }
  // Do not erase the previous copy or other drafts when the browser rejects this write.
  // Browser quota may be below our limit; surface that failure rather than claiming saved.
  storage.setItem(key, serialized);
  for (const item of remove) storage.removeItem(item);
}
export function clearDraft(key: string, storage: Storage = sessionStorage) {
  storage.removeItem(key);
}
export function clearAccountDrafts(
  account: string,
  storage: Storage = sessionStorage,
) {
  for (const key of keys(storage)) {
    let owner: string;
    try {
      owner = JSON.parse(key.slice(prefix.length))[0];
    } catch {
      continue;
    }
    if (owner === account) storage.removeItem(key);
  }
}
export function clearOtherAccountDrafts(
  account: string,
  storage: Storage = sessionStorage,
) {
  for (const key of keys(storage)) {
    let owner: string;
    try {
      owner = JSON.parse(key.slice(prefix.length))[0];
    } catch {
      continue;
    }
    if (owner !== account) storage.removeItem(key);
  }
}
export function draftConflicts(
  draft: DraftEnvelope,
  revision: number | null,
  state: DraftState,
) {
  if (draft.base_revision !== null && revision !== null)
    return draft.base_revision !== revision;
  return (["status", "decided_at", "review_id"] as const).some(
    (key) => (draft.base_state[key] ?? null) !== (state[key] ?? null),
  );
}

/** Qualification cleanup must not depend on the formerly readable target mounting. */
export function clearInternalCommentDrafts(
  account: string,
  storage: Storage = sessionStorage,
) {
  for (const key of keys(storage)) {
    let parts: unknown;
    try {
      parts = JSON.parse(key.slice(prefix.length));
    } catch {
      continue;
    }
    if (
      !Array.isArray(parts) ||
      parts[0] !== account ||
      parts[1] !== "scan_comment"
    )
      continue;
    const raw = storage.getItem(key);
    let value: DraftEnvelope | null;
    try {
      value = JSON.parse(raw || "null");
    } catch {
      continue;
    }
    if (value?.fields?.internal === true) storage.removeItem(key);
  }
}
