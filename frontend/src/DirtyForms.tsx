import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useBlocker } from "react-router-dom";
import { sessionCoordinator } from "./session";
type Form = { dirty: () => boolean; flush: () => void };
const DirtyFormsContext = createContext({
  register: (_id: string, _form: Form) => () => {},
  confirmLeave: (): boolean => true,
});
/** One router blocker coordinates every mounted form, including local editor closes. */
export function DirtyFormsProvider({ children }: { children: ReactNode }) {
  const forms = useRef(new Map<string, Form>());
  const flush = useCallback(() => {
    for (const form of forms.current.values()) form.flush();
  }, []);
  const dirty = useCallback(
    () => [...forms.current.values()].some((form) => form.dirty()),
    [],
  );
  const confirmLeave = useCallback(() => {
    flush();
    return (
      !dirty() ||
      window.confirm(
        "작성 중인 내용이 있습니다. 이 화면을 나갈까요? / Leave with unsent changes? Drafts remain in this tab when browser storage is available.",
      )
    );
  }, [flush, dirty]);
  const register = useCallback((id: string, form: Form) => {
    forms.current.set(id, form);
    return () => {
      form.flush();
      forms.current.delete(id);
    };
  }, []);
  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (confirmLeave()) blocker.proceed();
    else blocker.reset();
  }, [blocker.state, confirmLeave]);
  useEffect(() => {
    const unregister = sessionCoordinator.registerFlush(flush);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      flush();
      if (dirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      unregister();
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, [flush, dirty]);
  return (
    <DirtyFormsContext.Provider value={{ register, confirmLeave }}>
      {children}
    </DirtyFormsContext.Provider>
  );
}
export const useDirtyForms = () => useContext(DirtyFormsContext);
