import { useState } from "react";
import { sendAsAccount } from "./api";
import { useApp } from "./context";

/** Forms keep their opening account even if a cookie changes in another tab. */
export function useAccountMutation() {
  const { user } = useApp();
  const [ownerId] = useState(user.id);
  return <T = any>(path: string, body: unknown, method = "POST") =>
    sendAsAccount<T>(path, body, ownerId, method);
}
