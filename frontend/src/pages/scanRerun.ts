import type { Job } from "../api";
export type RerunMode = "latest" | "snapshot";
export const snapshotCommit = (job: Job) => {
  const value = job.target_commit || job.resolved_commit;
  return value && /^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(value) ? value : null;
};
export function rerunFields(job?: Job) {
  return {
    type: job?.source_type || "git",
    url: job?.source_type === "git" ? job.source : "",
    ref: job?.ref || "",
    profile: job?.profile || "static",
    force: false,
  };
}
