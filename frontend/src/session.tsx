export type SessionCapture = { accountId: string | null; generation: number };

/** Coordinates in-flight responses and synchronous draft flushes within this tab. */
export class SessionCoordinator {
  private accountId: string | null = null;
  private generation = 0;
  private expired = false;
  private flushes = new Set<() => void>();
  private listeners = new Set<() => void>();

  capture(): SessionCapture {
    return { accountId: this.accountId, generation: this.generation };
  }
  isCurrent(capture: SessionCapture): boolean {
    return (
      capture.accountId === this.accountId &&
      capture.generation === this.generation
    );
  }
  setAccount(accountId: string | null) {
    if (accountId !== this.accountId) {
      this.accountId = accountId;
      this.invalidate();
    }
  }
  invalidate() {
    this.generation++;
    this.expired = false;
  }
  registerFlush(flush: () => void) {
    this.flushes.add(flush);
    return () => {
      this.flushes.delete(flush);
    };
  }
  flush() {
    // A failed storage writer must not prevent the other open forms from flushing.
    for (const flush of this.flushes) {
      try {
        flush();
      } catch {
        /* The form owns its visible storage error. */
      }
    }
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  expire(capture: SessionCapture) {
    if (!capture.accountId || !this.isCurrent(capture) || this.expired) return;
    this.expired = true;
    this.flush();
    for (const listener of this.listeners) listener();
  }
}

export const sessionCoordinator = new SessionCoordinator();

/** An observation coordinates tabs; only /auth/me establishes server identity. */
export function publishAccountObservation(accountId: string | null) {
  const account = accountId ?? "";
  if (localStorage.getItem("aag-auth-observed-account") === account) return;
  localStorage.setItem("aag-auth-observed-account", account);
  localStorage.setItem("aag-auth-change", crypto.randomUUID());
}
