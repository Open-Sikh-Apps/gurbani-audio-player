/** Native nitro-player progress is ~250ms. Flush at that rate while the UI is visible. */
export const PROGRESS_UI_FLUSH_MS = 250;
/** Background JS does not need a moving scrubber; 1s is enough for sleep/resume. */
export const PROGRESS_BACKGROUND_FLUSH_MS = 1000;

export function progressFlushDelayMs(appState: string): number {
  return appState === "active"
    ? PROGRESS_UI_FLUSH_MS
    : PROGRESS_BACKGROUND_FLUSH_MS;
}

type Timer = ReturnType<typeof setTimeout>;

/**
 * Latest-wins delay: the first call arms a timer; later calls only replace the
 * payload. A hours-long queue of native progress callbacks becomes one emit.
 */
export function createLatestWinsScheduler(delayMs: () => number): {
  schedule: (run: () => void) => void;
  flush: () => void;
  cancel: () => void;
} {
  let timer: Timer | null = null;
  let pending: (() => void) | null = null;

  function fire(): void {
    timer = null;
    const run = pending;
    pending = null;
    run?.();
  }

  return {
    schedule(run) {
      pending = run;
      if (timer != null) {
        return;
      }
      timer = setTimeout(fire, delayMs());
    },
    flush() {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      fire();
    },
    cancel() {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
    },
  };
}
