import { createContext, useContext } from "react";
import type { User } from "./api";
export const AppContext = createContext<{
  user: User;
  boards: boolean;
  reviewWorkflow?: boolean;
  apiKeysState: "available" | "disabled" | "identity_unconfigured";
  lang: string;
  syncDisplayName: (ownerId: string, refreshPage: boolean) => void;
  profileRevision: number;
  reconcileSession: (ownerId?: string) => void;
}>({
  user: { id: "", name: "", role: "user", reviewer: false },
  boards: false,
  apiKeysState: "disabled",
  lang: "ko",
  syncDisplayName: () => {},
  profileRevision: 0,
  reconcileSession: () => {},
});
export const useApp = () => useContext(AppContext);
export function useText() {
  const { lang } = useApp();
  return (ko: string, en: string) => (lang === "ko" ? ko : en);
}
