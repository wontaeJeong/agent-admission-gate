import { beforeEach, describe, expect, it } from "vitest";
import {
  draftKey,
  readDraft,
  writeDraft,
  clearDraft,
  clearAccountDrafts,
  clearInternalCommentDrafts,
  clearOtherAccountDrafts,
  draftConflicts,
  type DraftEnvelope,
} from "./drafts";
class MemoryStorage implements Storage {
  values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}
const now = 1_800_000_000_000;
let storage: MemoryStorage;
const envelope = (
  target = "new",
  fields: Record<string, unknown> = { reason: "Review this source" },
): DraftEnvelope => ({
  schema_version: 1,
  account_id: "alice",
  kind: "review_request",
  target_id: target,
  base_revision: null,
  base_state: { status: "COMPLETED", decided_at: null, review_id: null },
  saved_at: now,
  fields,
});
beforeEach(() => {
  storage = new MemoryStorage();
});
describe("account scoped draft storage", () => {
  // Catch TTL off-by-one, missing target/account isolation, unsafe field copies and eviction errors.
  it("expires at the 24-hour boundary and removes expired data", () => {
    const key = draftKey("alice", "review_request", "new");
    writeDraft(key, envelope(), now, storage);
    expect(readDraft(key, now + 86_399_999, storage)?.fields).toEqual({
      reason: "Review this source",
    });
    expect(readDraft(key, now + 86_400_000, storage)).toBeNull();
    expect(storage.getItem(key)).toBeNull();
  });
  it("removes the oldest on the 21st draft without touching unrelated storage", () => {
    storage.setItem("aag-theme", "dark");
    for (let index = 0; index < 21; index++)
      writeDraft(
        draftKey("alice", "review_request", String(index)),
        envelope(String(index)),
        now + index,
        storage,
      );
    expect(
      readDraft(draftKey("alice", "review_request", "0"), now + 21, storage),
    ).toBeNull();
    expect(
      readDraft(draftKey("alice", "review_request", "1"), now + 21, storage)
        ?.target_id,
    ).toBe("1");
    expect(storage.length).toBe(21);
    expect(storage.getItem("aag-theme")).toBe("dark");
  });
  it("evicts oldest drafts to stay within a total 256 KiB", () => {
    for (let index = 0; index < 4; index++)
      writeDraft(
        draftKey("alice", "review_request", String(index)),
        envelope(String(index), { reason: "한".repeat(30000) }),
        now + index,
        storage,
      );
    expect(
      readDraft(draftKey("alice", "review_request", "0"), now + 4, storage),
    ).toBeNull();
    expect(
      readDraft(draftKey("alice", "review_request", "3"), now + 4, storage)
        ?.fields.reason,
    ).toHaveLength(30000);
    expect(
      new TextEncoder().encode([...storage.values.values()].join("")).length,
    ).toBeLessThanOrEqual(262144);
  });
  it("reports an oversized draft without erasing the existing draft", () => {
    const key = draftKey("alice", "review_request", "new");
    writeDraft(key, envelope(), now, storage);
    expect(() =>
      writeDraft(
        key,
        envelope("new", { reason: "x".repeat(262145) }),
        now + 1,
        storage,
      ),
    ).toThrow();
    expect(readDraft(key, now + 1, storage)?.fields.reason).toBe(
      "Review this source",
    );
  });
  it("never restores an unknown schema or mismatched owner", () => {
    const key = draftKey("alice", "review_request", "new");
    storage.setItem(key, JSON.stringify({ ...envelope(), schema_version: 2 }));
    expect(() => readDraft(key, now, storage)).toThrow();
    storage.setItem(key, JSON.stringify({ ...envelope(), account_id: "bob" }));
    expect(() => readDraft(key, now, storage)).toThrow();
  });
  it("separates account and target and only clears the requested draft/account", () => {
    writeDraft(
      draftKey("alice", "review_request", "a"),
      envelope("a"),
      now,
      storage,
    );
    writeDraft(
      draftKey("alice", "review_request", "b"),
      envelope("b"),
      now,
      storage,
    );
    writeDraft(
      draftKey("bob", "review_request", "a"),
      { ...envelope("a"), account_id: "bob" },
      now,
      storage,
    );
    clearDraft(draftKey("alice", "review_request", "a"), storage);
    expect(
      readDraft(draftKey("alice", "review_request", "b"), now, storage)
        ?.target_id,
    ).toBe("b");
    clearAccountDrafts("alice", storage);
    expect(storage.length).toBe(1);
    expect(
      readDraft(draftKey("bob", "review_request", "a"), now, storage)
        ?.account_id,
    ).toBe("bob");
  });
  it("uses primitive allowlists and excludes PAT, token, file and unknown nested fields", () => {
    const key = draftKey("alice", "scan_new", "new");
    writeDraft(
      key,
      {
        ...envelope(),
        kind: "scan_new",
        fields: {
          type: "git",
          url: "https://example.test/repo",
          ref: "main",
          profile: "static",
          force: true,
          credential: "PAT",
          token: "TOKEN",
          file: "FILE",
          handle: {},
          reason: "unknown",
          nested: { token: "secret" },
        },
      },
      now,
      storage,
    );
    expect(readDraft(key, now, storage)?.fields).toEqual({
      type: "git",
      url: "https://example.test/repo",
      ref: "main",
      profile: "static",
      force: true,
    });
    expect(storage.getItem(key)).not.toMatch(/PAT|TOKEN|FILE|secret/);
    storage.setItem(
      key,
      JSON.stringify({
        ...envelope(),
        kind: "scan_new",
        fields: { url: { token: "secret" }, credential: "PAT" },
      }),
    );
    expect(readDraft(key, now, storage)?.fields).toEqual({});
  });
  it.each([
    "https://user:PAT@example.test/repo",
    "https://example.test/repo?access_token=PAT",
    "https://example.test/repo#token=PAT",
  ])("omits embedded credentials from an allowed URL field: %s", (url) => {
    const key = draftKey("alice", "scan_new", "new");
    writeDraft(
      key,
      { ...envelope(), kind: "scan_new", fields: { url, ref: "main" } },
      now,
      storage,
    );
    expect(readDraft(key, now, storage)?.fields).toEqual({ ref: "main" });
    expect(storage.getItem(key)).not.toContain("PAT");
  });
  it("propagates storage failures so the form can show unsaved state", () => {
    storage.setItem = () => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
    expect(() =>
      writeDraft(
        draftKey("alice", "review_request", "new"),
        envelope(),
        now,
        storage,
      ),
    ).toThrow("Quota exceeded");
  });
});

it("discards foreign drafts on verified account change without touching current drafts", () => {
  writeDraft(
    draftKey("alice", "review_request", "new"),
    envelope(),
    now,
    storage,
  );
  writeDraft(
    draftKey("bob", "review_request", "new"),
    { ...envelope(), account_id: "bob" },
    now,
    storage,
  );
  clearOtherAccountDrafts("bob", storage);
  expect(
    readDraft(draftKey("alice", "review_request", "new"), now, storage),
  ).toBeNull();
  expect(
    readDraft(draftKey("bob", "review_request", "new"), now, storage)
      ?.account_id,
  ).toBe("bob");
});
it("prefers revision conflicts and uses current review state when revisions are absent", () => {
  expect(
    draftConflicts(
      { ...envelope(), base_revision: 1 },
      2,
      envelope().base_state,
    ),
  ).toBe(true);
  expect(
    draftConflicts({ ...envelope(), base_revision: 1 }, 1, {
      status: "rejected",
    }),
  ).toBe(false);
  expect(
    draftConflicts(envelope(), null, {
      status: "COMPLETED",
      review_id: "new-review",
    }),
  ).toBe(true);
  expect(
    draftConflicts(
      {
        ...envelope(),
        base_state: { status: "pending", decided_at: null, review_id: "r" },
      },
      null,
      { status: "approved", decided_at: "1760000004", review_id: "r" },
    ),
  ).toBe(true);
  expect(
    draftConflicts(envelope(), null, {
      status: "COMPLETED",
      decided_at: null,
      review_id: null,
    }),
  ).toBe(false);
});
it("does not swallow removal failures during explicit sign-out", () => {
  writeDraft(
    draftKey("alice", "review_request", "new"),
    envelope(),
    now,
    storage,
  );
  storage.removeItem = () => {
    throw new DOMException("Unavailable", "SecurityError");
  };
  expect(() => clearAccountDrafts("alice", storage)).toThrow("Unavailable");
});

it("qualification cleanup removes only the current account's internal comments", () => {
  const comment = {
    ...envelope("internal"),
    kind: "scan_comment" as const,
    fields: { body: "Synthetic internal", internal: true },
  };
  writeDraft(
    draftKey("alice", "scan_comment", "internal"),
    comment,
    now,
    storage,
  );
  writeDraft(
    draftKey("alice", "scan_comment", "public"),
    {
      ...comment,
      target_id: "public",
      fields: { body: "Public", internal: false },
    },
    now,
    storage,
  );
  writeDraft(
    draftKey("bob", "scan_comment", "internal"),
    { ...comment, account_id: "bob" },
    now,
    storage,
  );
  clearInternalCommentDrafts("alice", storage);
  expect(
    readDraft(draftKey("alice", "scan_comment", "internal"), now, storage),
  ).toBeNull();
  expect(
    readDraft(draftKey("alice", "scan_comment", "public"), now, storage)?.fields
      .body,
  ).toBe("Public");
  expect(
    readDraft(draftKey("bob", "scan_comment", "internal"), now, storage)?.fields
      .internal,
  ).toBe(true);
});
