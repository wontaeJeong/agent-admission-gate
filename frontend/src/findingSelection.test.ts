import { describe, expect, it } from "vitest";
import {
  findingEntries,
  selectFinding,
  findingHref,
  parseFindingSelection,
  filterFindings,
} from "./findingSelection";
import type { Finding } from "./api";
const findings = [
  {
    fingerprint: "same",
    title: "first",
    severity: "high",
    engine: "a",
    path: "first.py",
  },
  {
    fingerprint: "other",
    title: "other",
    severity: "low",
    engine: "b",
    path: "other.py",
  },
  {
    fingerprint: "same",
    title: "second",
    severity: "low",
    engine: "b",
    path: "second.py",
  },
] as Finding[];
describe("precise finding selection", () => {
  it("test_duplicate_fingerprint_occurrence", () => {
    expect(selectFinding(findings, "same", 1)).toMatchObject({
      status: "selected",
      entry: { finding: { title: "second" }, occurrence: 1, index: 2 },
    });
    expect(findingEntries(findings).map((e) => e.occurrence)).toEqual([
      0, 0, 1,
    ]);
    expect(findingHref("job", "same", 1)).toBe(
      "/jobs/job?tab=findings&finding=same&occurrence=1",
    );
  });
  it("test_missing_finding_not_replaced", () => {
    for (const occurrence of [-1, 0.5, NaN, 2])
      expect(selectFinding(findings, "same", occurrence).status).toBe(
        "missing",
      );
    expect(selectFinding(findings, "unknown", 0).status).toBe("missing");
  });
  it("test_filter_excludes_linked_finding", () => {
    const filtered = filterFindings(findingEntries(findings), {
      severity: "high",
      engine: "a",
      q: "first",
    });
    expect(filtered).toHaveLength(1);
    expect(selectFinding(findings, "same", 1)).toMatchObject({
      status: "selected",
      entry: { index: 2 },
    });
    expect(
      filterFindings(findingEntries(findings), {
        severity: "all",
        engine: "b",
        q: "second.py",
      })[0].occurrence,
    ).toBe(1);
  });
  it("rejects explicit malformed, partial and duplicate selection without defaulting", () => {
    for (const query of [
      "finding=same",
      "occurrence=0",
      "finding=same&occurrence=01",
      "finding=same&occurrence=-1",
      "finding=same&occurrence=x",
      "finding=&occurrence=0",
      "finding=same&occurrence=0&occurrence=1",
      "finding=same&finding=other&occurrence=0",
    ])
      expect(parseFindingSelection(new URLSearchParams(query))).toEqual({
        status: "missing",
      });
    expect(parseFindingSelection(new URLSearchParams())).toEqual({
      status: "absent",
    });
    expect(
      parseFindingSelection(new URLSearchParams("finding=same&occurrence=1")),
    ).toEqual({ status: "valid", fingerprint: "same", occurrence: 1 });
  });
});
