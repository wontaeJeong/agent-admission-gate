import { useLayoutEffect, useRef, useState } from "react";
import { sessionCoordinator } from "./session";

/** Receipt safety for memory-only forms. Never reads or writes browser storage. */
export function useMemorySubmission() {
  const [owner] = useState(() => sessionCoordinator.capture());
  const mounted = useRef(false);
  const version = useRef(0);
  const sequence = useRef(0);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () => mounted.current && sessionCoordinator.isCurrent(owner);
  const touch = () => {
    version.current++;
  };
  const beginSubmission = <T>(fields: T) => ({
    fields,
    version: version.current,
    sequence: ++sequence.current,
  });
  const isCurrentSubmission = (receipt: { sequence: number }) =>
    current() && receipt.sequence === sequence.current;
  const markSubmitted = (receipt: { sequence: number; version: number }) => {
    if (!isCurrentSubmission(receipt) || receipt.version !== version.current)
      return false;
    touch();
    return true;
  };
  return { touch, beginSubmission, isCurrentSubmission, markSubmitted };
}
