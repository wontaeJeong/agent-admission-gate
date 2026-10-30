import { createContext, useContext } from "react";
import type { User } from "./api";
export const AppContext = createContext<{
  user: User;
  boards: boolean;
  lang: string;
}>({
  user: { id: "", name: "", role: "user", reviewer: false },
  boards: false,
  lang: "ko",
});
export const useApp = () => useContext(AppContext);
export function useText() {
  const { lang } = useApp();
  return (ko: string, en: string) => (lang === "ko" ? ko : en);
}
