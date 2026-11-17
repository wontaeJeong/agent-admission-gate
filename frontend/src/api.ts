import { sessionCoordinator } from "./session";

export class APIError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
/** Read recovery never gives a write request a replay action. */
export function requestRecovery(error: unknown, method: string) {
  return {
    status: error instanceof APIError ? error.status : null,
    retryable:
      method.toUpperCase() === "GET" &&
      (error instanceof TypeError ||
        (error instanceof APIError &&
          error.status >= 500 &&
          error.status < 600)),
  };
}
export async function api<T = any>(
  path: string,
  init: RequestInit = {},
  responseType: "json" | "text" = "json",
): Promise<T> {
  const capture = sessionCoordinator.capture();
  const response = await fetch("/api" + path, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...init.headers,
    },
  });
  const data =
    response.ok && responseType === "text"
      ? await response.text()
      : await response.json().catch(() => ({}));
  if (!sessionCoordinator.isCurrent(capture))
    throw new APIError(
      409,
      "Account changed; reopen the form before submitting",
    );
  if (response.status === 401 && path !== "/auth/login")
    sessionCoordinator.expire(capture);
  if (!response.ok)
    throw new APIError(
      response.status,
      typeof data.detail === "string"
        ? data.detail
        : data.detail
          ? data.detail.map((d: any) => d.msg).join("; ")
          : `HTTP ${response.status}`,
    );
  return data;
}
export const send = <T = any>(path: string, body: unknown, method = "POST") =>
  api<T>(path, { method, body: JSON.stringify(body) });
export const sendAsAccount = <T = any>(
  path: string,
  body: unknown,
  accountId: string,
  method = "POST",
): Promise<T> => {
  if (sessionCoordinator.capture().accountId !== accountId)
    return Promise.reject(
      new APIError(409, "Account changed; reopen the form before submitting"),
    );
  return api<T>(path, {
    method,
    body: body instanceof FormData ? body : JSON.stringify(body),
    headers: { "X-AAG-Account": accountId },
  });
};
export type User = {
  id: string;
  name: string;
  role: "user" | "admin";
  reviewer: boolean;
};
export type Finding = {
  fingerprint: string;
  engine: string;
  rule: string;
  severity: string;
  title: string;
  path: string;
  line?: number;
  action: string;
  evidence: string;
  remediation: string;
  suppressed: boolean;
};
export type Engine = {
  name: string;
  status: string;
  required: boolean;
  duration_ms?: number;
  started_at?: number;
  error?: string;
  packages?: number;
};
export type Job = {
  id: string;
  owner_id: string;
  source: string;
  source_type: string;
  ref: string | null;
  profile: string;
  status: string;
  verdict: string | null;
  effective_verdict: string | null;
  error: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  origin_job_id: string | null;
  lineage_root_id: string | null;
  target_commit: string | null;
  rerun_mode: "latest" | "snapshot" | null;
  resolved_commit: string | null;
  content_hash: string | null;
  cached_from: string | null;
  review?: { id: string; status: "pending" | "approved" | "rejected" } | null;
  result: {
    findings?: Finding[];
    engines?: Engine[];
    coverage_complete?: boolean;
    limitations?: string[];
    [key: string]: any;
  };
};
export function timestamp(value: number | null | undefined) {
  return value ? new Date(value * 1000).toLocaleString() : "—";
}
export function number(value: number | null | undefined) {
  return value == null
    ? "—"
    : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
