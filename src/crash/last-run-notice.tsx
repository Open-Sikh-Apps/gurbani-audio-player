import { useEffect } from "react";

import { maybeShowLastRunCrashAlert } from "@/crash/last-run";

/** Mounts the last-run crash Alert after first paint; Sentry stays in last-run.ts. */
export function CrashLastRunNotice() {
  useEffect(() => {
    void maybeShowLastRunCrashAlert();
  }, []);
  return null;
}
