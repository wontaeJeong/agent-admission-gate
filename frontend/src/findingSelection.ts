import type { Finding } from "./api";
export type FindingEntry = {
  finding: Finding;
  occurrence: number;
  index: number;
};
/** Count duplicates in the full persisted order, before applying any filters. */
export function findingEntries(findings: Finding[]): FindingEntry[] {
  const counts = new Map<string, number>();
  return findings.map((finding, index) => {
    const occurrence = counts.get(finding.fingerprint) || 0;
    counts.set(finding.fingerprint, occurrence + 1);
    return { finding, index, occurrence };
  });
}
export function selectFinding(
  findings: Finding[],
  fingerprint: string,
  occurrence: number,
): { status: "selected"; entry: FindingEntry } | { status: "missing" } {
  if (!fingerprint || !Number.isSafeInteger(occurrence) || occurrence < 0)
    return { status: "missing" };
  const entry = findingEntries(findings).find(
    (e) => e.finding.fingerprint === fingerprint && e.occurrence === occurrence,
  );
  return entry ? { status: "selected", entry } : { status: "missing" };
}
export function findingHref(
  id: string,
  fingerprint: string,
  occurrence: number,
) {
  return (
    `/jobs/${encodeURIComponent(id)}?` +
    new URLSearchParams({
      tab: "findings",
      finding: fingerprint,
      occurrence: String(occurrence),
    })
  );
}
export function parseFindingSelection(
  params: URLSearchParams,
):
  | { status: "absent" }
  | { status: "missing" }
  | { status: "valid"; fingerprint: string; occurrence: number } {
  if (!params.has("finding") && !params.has("occurrence"))
    return { status: "absent" };
  const fingerprint = params.get("finding"),
    raw = params.get("occurrence");
  if (
    params.getAll("finding").length !== 1 ||
    params.getAll("occurrence").length !== 1 ||
    !fingerprint ||
    !raw ||
    !/^(0|[1-9]\d*)$/.test(raw) ||
    !Number.isSafeInteger(Number(raw))
  )
    return { status: "missing" };
  return { status: "valid", fingerprint, occurrence: Number(raw) };
}
export function filterFindings(
  entries: FindingEntry[],
  filters: { severity: string; engine: string; q: string },
) {
  const q = filters.q.trim().toLocaleLowerCase();
  return entries.filter(
    ({ finding: f }) =>
      (filters.severity === "all" || f.severity === filters.severity) &&
      (filters.engine === "all" || f.engine === filters.engine) &&
      (!q ||
        [f.title, f.rule, f.path, f.evidence, f.remediation].some((v) =>
          v?.toLocaleLowerCase().includes(q),
        )),
  );
}
