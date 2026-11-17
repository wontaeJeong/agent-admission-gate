import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useApp } from "./context";
import { useDirtyForms } from "./DirtyForms";
import {
  DraftSchemaError,
  allowedDraftFields,
  clearDraft,
  draftConflicts,
  draftKey,
  readDraft,
  writeDraft,
  type DraftEnvelope,
  type DraftFields,
  type DraftKind,
  type DraftState,
} from "./drafts";
import { sessionCoordinator } from "./session";
type Options = {
  kind: DraftKind;
  targetId: string;
  initialFields: DraftFields;
  enabled: boolean;
  writable?: boolean;
  baseRevision?: number | null;
  baseState?: DraftState;
  conflictToken?: object | null;
  allowCandidate?: (draft: DraftEnvelope<DraftFields>) => boolean;
};
type DraftSubmission = {
  instance: symbol;
  sequence: number;
  version: number;
  fields: DraftFields;
  baseRevision: number | null;
};
const draftOwners = new Map<string, symbol>();
export function useDraft(options: Options) {
  const { user } = useApp();
  const [owner] = useState(() => ({
    ...sessionCoordinator.capture(),
    accountId: user.id,
  }));
  const key = draftKey(owner.accountId, options.kind, options.targetId);
  const [instance] = useState(() => Symbol("draft-form"));
  const mounted = useRef(false);
  const submissionSequence = useRef(0);
  const acknowledgedConflict = useRef<object | null>(null);
  // Invalidate completion effects with the DOM unmount, before passive cleanup.
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [fields, setFields] = useState<DraftFields>(options.initialFields);
  const [candidate, setCandidate] = useState<DraftEnvelope<DraftFields> | null>(
    null,
  );
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [readError, setReadError] = useState(false);
  const state = useRef({
    fields,
    candidate,
    dirty: false,
    // Monotonic within this form: resets must never reuse a pending receipt.
    version: 0,
    written: 0,
    changedAt: 0,
    loaded: false,
    readError: false,
    baseRevision: options.baseRevision ?? null,
    baseState: options.baseState ?? {},
  });
  const latest = useRef(options);
  latest.current = options;
  const id = useId(),
    { register } = useDirtyForms();
  const current = () =>
    mounted.current &&
    draftOwners.get(key) === instance &&
    sessionCoordinator.isCurrent(owner);
  const conflict =
    !!(
      options.conflictToken &&
      options.conflictToken !== acknowledgedConflict.current &&
      (candidate || state.current.dirty)
    ) ||
    !!(
      candidate &&
      draftConflicts(
        candidate,
        options.baseRevision ?? null,
        options.baseState ?? {},
      )
    ) ||
    (state.current.dirty &&
      draftConflicts(
        {
          base_revision: state.current.baseRevision,
          base_state: state.current.baseState,
        } as DraftEnvelope,
        options.baseRevision ?? null,
        options.baseState ?? {},
      ));
  const effectiveCandidate =
    candidate ??
    (conflict || (state.current.dirty && options.writable === false)
      ? {
          schema_version: 1,
          account_id: owner.accountId,
          kind: options.kind,
          target_id: options.targetId,
          base_revision: state.current.baseRevision,
          base_state: state.current.baseState,
          saved_at: state.current.changedAt,
          fields,
        }
      : null);
  const flush = useCallback(() => {
    const s = state.current,
      o = latest.current;
    if (
      !sessionCoordinator.isCurrent(owner) ||
      draftOwners.get(key) !== instance ||
      !o.enabled ||
      !s.loaded ||
      s.candidate ||
      s.readError ||
      !s.dirty ||
      s.version === s.written
    )
      return;
    // Keep the original base while editing. A later GET must not bless stale input.
    try {
      writeDraft(
        key,
        {
          schema_version: 1,
          account_id: owner.accountId,
          kind: o.kind,
          target_id: o.targetId,
          base_revision: s.baseRevision,
          base_state: s.baseState,
          saved_at: s.changedAt,
          fields: s.fields,
        },
        s.changedAt,
      );
      s.written = s.version;
      setSavedAt(s.changedAt);
      setError(false);
    } catch {
      setSavedAt(null);
      setError(true);
    }
  }, [key, owner, instance]);
  useEffect(() => {
    draftOwners.set(key, instance);
    const unregister = register(id, {
      dirty: () => state.current.dirty && current(),
      flush,
    });
    return () => {
      // The departing owner gets one final flush, then cannot affect its replacement.
      unregister();
      if (draftOwners.get(key) === instance) draftOwners.delete(key);
    };
  }, [register, id, flush, owner, key, instance]);
  useEffect(() => {
    if (!options.enabled || state.current.loaded || !current()) return;
    state.current.loaded = true;
    state.current.baseRevision = options.baseRevision ?? null;
    state.current.baseState = options.baseState ?? {};
    try {
      const draft = readDraft(key, Date.now());
      if (draft && options.allowCandidate && !options.allowCandidate(draft)) {
        clearDraft(key);
        return;
      }
      state.current.candidate = draft;
      setCandidate(draft);
    } catch (error) {
      // Unsupported data needs an explicit discard. Unavailable browser storage
      // must still allow the underlying form to be edited and submitted.
      state.current.readError = error instanceof DraftSchemaError;
      setReadError(state.current.readError);
      setError(true);
    }
  });
  // An explicit discard may precede the verified post-conflict read. Once that
  // read arrives, a pristine form adopts its current server fields/base together.
  useLayoutEffect(() => {
    const s = state.current;
    const revision = options.baseRevision ?? null;
    if (
      !options.conflictToken ||
      !options.writable ||
      !s.loaded ||
      s.dirty ||
      s.candidate ||
      s.readError ||
      revision === s.baseRevision
    )
      return;
    s.baseRevision = revision;
    s.baseState = options.baseState ?? {};
    s.fields = options.initialFields;
    s.version++;
    s.written = s.version;
    setFields(s.fields);
  }, [options.baseRevision, options.writable, options.conflictToken]);
  // Revoked internal-comment qualification removes both stored and in-memory content.
  useEffect(() => {
    const s = state.current;
    const draft =
      s.candidate ?? ({ fields: s.fields } as DraftEnvelope<DraftFields>);
    if (
      !options.enabled ||
      !options.allowCandidate ||
      options.allowCandidate(draft)
    )
      return;
    try {
      clearDraft(key);
    } catch {
      setError(true);
    }
    s.fields = options.initialFields;
    s.candidate = null;
    s.dirty = false;
    s.version++;
    s.written = s.version;
    setFields(options.initialFields);
    setCandidate(null);
    setDirty(false);
    setSavedAt(null);
  });
  useEffect(() => {
    const timer = setTimeout(flush, 300);
    return () => clearTimeout(timer);
  }, [fields, dirty, flush]);
  const update = (name: string, value: string | boolean) => {
    const s = state.current;
    if (
      s.candidate ||
      s.readError ||
      !current() ||
      latest.current.writable === false ||
      conflict
    )
      return;
    s.fields = { ...s.fields, [name]: value };
    s.dirty = true;
    s.version++;
    s.changedAt = Date.now();
    setFields(s.fields);
    setDirty(true);
    setSavedAt(null);
  };
  const touch = () => update("__sensitive_change", "");
  const discard = () => {
    if (!current()) return;
    try {
      clearDraft(key);
      const s = state.current;
      s.candidate = null;
      s.dirty = false;
      s.version++;
      s.written = s.version;
      s.readError = false;
      acknowledgedConflict.current = latest.current.conflictToken ?? null;
      s.baseRevision = latest.current.baseRevision ?? null;
      s.baseState = latest.current.baseState ?? {};
      s.fields = latest.current.initialFields;
      setFields(s.fields);
      setCandidate(null);
      setDirty(false);
      setSavedAt(null);
      setError(false);
      setReadError(false);
    } catch {
      setError(true);
    }
  };
  const restore = () => {
    if (!current() || latest.current.writable === false || !effectiveCandidate)
      return;
    const s = state.current;
    s.fields = {
      ...latest.current.initialFields,
      ...effectiveCandidate.fields,
    };
    s.candidate = null;
    s.dirty = true;
    acknowledgedConflict.current = latest.current.conflictToken ?? null;
    s.baseRevision = latest.current.baseRevision ?? null;
    s.baseState = latest.current.baseState ?? {};
    s.version++;
    s.changedAt = Date.now();
    setFields(s.fields);
    setCandidate(null);
    setDirty(true);
    setSavedAt(null);
  };
  const beginSubmission = (): DraftSubmission => ({
    instance,
    sequence: ++submissionSequence.current,
    version: state.current.version,
    fields: { ...state.current.fields },
    baseRevision: state.current.baseRevision,
  });
  const isCurrentSubmission = (submission: DraftSubmission) =>
    current() &&
    submission.instance === instance &&
    submission.sequence === submissionSequence.current;
  const markSubmitted = (submission: DraftSubmission) => {
    if (
      !isCurrentSubmission(submission) ||
      submission.version !== state.current.version
    )
      return false;
    // Stop cleanup from recreating a submitted draft even if removeItem fails.
    state.current.dirty = false;
    state.current.version++;
    state.current.written = state.current.version;
    setDirty(false);
    setSavedAt(null);
    try {
      clearDraft(key);
      setCandidate(null);
      state.current.candidate = null;
      setError(false);
    } catch {
      setError(true);
    }
    return true;
  };
  const safe = allowedDraftFields(options.kind, fields);
  return {
    baseRevision: state.current.baseRevision,
    fields,
    update,
    touch,
    candidate: options.enabled ? effectiveCandidate : null,
    dirty,
    flush,
    discard,
    beginSubmission,
    isCurrentSubmission,
    markSubmitted,
    restore,
    error,
    readError,
    savedAt,
    conflict,
    writable: options.writable !== false,
    locked: !!effectiveCandidate || readError || options.writable === false,
    omittedUrl: !!fields.url && !safe.url,
  };
}
export type DraftController = ReturnType<typeof useDraft>;
