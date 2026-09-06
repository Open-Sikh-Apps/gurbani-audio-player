import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import {
  PROGRESS_BACKGROUND_FLUSH_MS,
  PROGRESS_UI_FLUSH_MS,
  createLatestWinsScheduler,
  progressFlushDelayMs,
} from "./progress-scheduler";

afterEach(() => {
  mock.timers.reset();
});

describe("progressFlushDelayMs", () => {
  it("uses the UI interval only while the app is active", () => {
    assert.equal(progressFlushDelayMs("active"), PROGRESS_UI_FLUSH_MS);
    assert.equal(progressFlushDelayMs("background"), PROGRESS_BACKGROUND_FLUSH_MS);
    assert.equal(progressFlushDelayMs("inactive"), PROGRESS_BACKGROUND_FLUSH_MS);
  });
});

describe("createLatestWinsScheduler", () => {
  it("runs the latest scheduled callback once after the delay", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const calls: number[] = [];
    const scheduler = createLatestWinsScheduler(() => 250);

    scheduler.schedule(() => calls.push(1));
    scheduler.schedule(() => calls.push(2));
    scheduler.schedule(() => calls.push(3));
    assert.deepEqual(calls, []);

    mock.timers.tick(249);
    assert.deepEqual(calls, []);
    mock.timers.tick(1);
    assert.deepEqual(calls, [3]);
  });

  it("does not collapse callbacks across separate delay windows", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const calls: number[] = [];
    const scheduler = createLatestWinsScheduler(() => 250);

    scheduler.schedule(() => calls.push(1));
    mock.timers.tick(250);
    scheduler.schedule(() => calls.push(2));
    mock.timers.tick(250);
    assert.deepEqual(calls, [1, 2]);
  });

  it("flush runs the pending callback immediately", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const calls: number[] = [];
    const scheduler = createLatestWinsScheduler(() => 1000);

    scheduler.schedule(() => calls.push(1));
    scheduler.flush();
    assert.deepEqual(calls, [1]);
    mock.timers.tick(1000);
    assert.deepEqual(calls, [1]);
  });

  it("cancel drops the pending callback", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const calls: number[] = [];
    const scheduler = createLatestWinsScheduler(() => 250);

    scheduler.schedule(() => calls.push(1));
    scheduler.cancel();
    mock.timers.tick(250);
    assert.deepEqual(calls, []);
  });
});
