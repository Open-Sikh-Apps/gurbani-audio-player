import { AppState } from "react-native";
import { create } from "zustand";

import { getPlayerEngine } from "@/playback/engine";
import { usePlaybackStore } from "@/playback/status-store";
import { PLAYBACK_RATE_MIN, type PlayerStatus } from "@/playback/types";

export type SleepKind = "off" | "track" | "album" | "duration" | "tracks";

type SleepTimerState = {
  kind: SleepKind;
  deadlineAt: number | null;
  remainingSec: number;
  remainingTrackEnds: number;
  armedTrackId: string | null;
  armedIndex: number | null;
};

const idle: SleepTimerState = {
  kind: "off",
  deadlineAt: null,
  remainingSec: 0,
  remainingTrackEnds: 0,
  armedTrackId: null,
  armedIndex: null,
};

export const useSleepTimerStore = create<SleepTimerState>(() => ({ ...idle }));

let started = false;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let durationFireTimer: ReturnType<typeof setTimeout> | null = null;

function remainingContentSec(
  status: PlayerStatus,
  kind: "track" | "album",
): number {
  if (!status.session) {
    return 0;
  }
  const current = Math.max(0, status.durationSec - status.positionSec);
  if (kind === "track") {
    return current;
  }
  const rest = status.session.tracks
    .slice(status.currentIndex + 1)
    .reduce((sum, track) => sum + (track.durationSec ?? 0), 0);
  return current + rest;
}

function wallSec(contentSec: number, rate: number): number {
  // Label and deadline are wall-clock; at 1.5× remaining audio is shorter than remainingSec.
  return contentSec / Math.max(rate, PLAYBACK_RATE_MIN);
}

function stopTicker(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

function clearDurationFire(): void {
  if (durationFireTimer) {
    clearTimeout(durationFireTimer);
    durationFireTimer = null;
  }
}

function armDurationFire(deadlineAt: number): void {
  clearDurationFire();
  const ms = Math.max(0, deadlineAt - Date.now());
  durationFireTimer = setTimeout(() => {
    durationFireTimer = null;
    if (useSleepTimerStore.getState().kind === "duration") {
      fire();
    }
  }, ms);
}

function startTicker(): void {
  if (tickTimer) {
    return;
  }
  tickTimer = setInterval(tick, 1000);
}

function fire(): void {
  if (useSleepTimerStore.getState().kind === "off") {
    return;
  }
  clearDurationFire();
  // Engine pause (not TrackPlayer) so the 2s rewind and resume persist still run.
  getPlayerEngine().pause();
  useSleepTimerStore.setState({ ...idle });
  stopTicker();
}

// Pause only — do not write remainingSec (that re-renders Now Playing on every progress tick).
function maybeFire(sleep: SleepTimerState, status: PlayerStatus, now: number): void {
  if (sleep.kind === "duration") {
    if (sleep.deadlineAt != null && now >= sleep.deadlineAt) {
      fire();
    }
    return;
  }
  if (sleep.kind === "tracks") {
    if (
      sleep.remainingTrackEnds <= 1 &&
      remainingContentSec(status, "track") <= 0.35
    ) {
      fire();
    }
    return;
  }
  if (sleep.kind !== "track" && sleep.kind !== "album") {
    return;
  }
  if (remainingContentSec(status, sleep.kind) <= 0.35) {
    fire();
  }
}

function tick(): void {
  const sleep = useSleepTimerStore.getState();
  if (sleep.kind === "off") {
    return;
  }
  const status = usePlaybackStore.getState();
  const now = Date.now();

  if (sleep.kind === "duration") {
    const remaining = Math.max(0, ((sleep.deadlineAt ?? now) - now) / 1000);
    useSleepTimerStore.setState({ remainingSec: remaining });
    maybeFire(sleep, status, now);
    return;
  }

  if (sleep.kind === "tracks") {
    tickTracks(sleep, status, now);
    return;
  }

  // Natural track end is a near-zero remaining then a new trackId. User skip
  // jumps earlier, so re-arm instead of pausing.
  if (
    sleep.kind === "track" &&
    sleep.armedTrackId &&
    status.currentTrackId &&
    status.currentTrackId !== sleep.armedTrackId
  ) {
    if (sleep.remainingSec < 5) {
      fire();
      return;
    }
    useSleepTimerStore.setState({ armedTrackId: status.currentTrackId });
  }

  const content = remainingContentSec(status, sleep.kind);
  const remaining = wallSec(content, status.rate);
  useSleepTimerStore.setState({
    remainingSec: remaining,
    deadlineAt: now + remaining * 1000,
    armedTrackId:
      sleep.kind === "track"
        ? (status.currentTrackId ?? sleep.armedTrackId)
        : sleep.armedTrackId,
  });
  maybeFire(useSleepTimerStore.getState(), status, now);
}

function tickTracks(
  sleep: SleepTimerState,
  status: PlayerStatus,
  now: number,
): void {
  let remainingEnds = sleep.remainingTrackEnds;
  if (
    sleep.armedTrackId &&
    status.currentTrackId &&
    status.currentTrackId !== sleep.armedTrackId
  ) {
    // Only skip-next / natural next consume a count; skip-previous does not.
    const movedForward = status.currentIndex > (sleep.armedIndex ?? -1);
    if (movedForward) {
      remainingEnds -= 1;
      if (remainingEnds <= 0) {
        fire();
        return;
      }
    }
  }

  const content = remainingContentSec(status, "track");
  const remaining = wallSec(content, status.rate);
  useSleepTimerStore.setState({
    remainingSec: remaining,
    remainingTrackEnds: remainingEnds,
    deadlineAt: now + remaining * 1000,
    armedTrackId: status.currentTrackId ?? sleep.armedTrackId,
    armedIndex: status.currentIndex,
  });
  if (remainingEnds <= 1 && content <= 0.35) {
    fire();
  }
}

export function initSleepTimer(): void {
  if (started) {
    return;
  }
  started = true;
  usePlaybackStore.subscribe((state, prev) => {
    const sleep = useSleepTimerStore.getState();
    if (sleep.kind === "off") {
      return;
    }
    if (
      state.currentTrackId !== prev.currentTrackId ||
      state.currentIndex !== prev.currentIndex
    ) {
      tick();
      return;
    }
    // RN can pause setTimeout in the background while native progress still
    // reaches JS. Check the deadline here so pause does not wait on foreground.
    maybeFire(sleep, state, Date.now());
  });
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      // Remaining-time label may have frozen; refresh it. Pause already ran from
      // progress/timeout if JS was alive.
      tick();
    }
  });
}

export function cancelSleepTimer(): void {
  clearDurationFire();
  useSleepTimerStore.setState({ ...idle });
  stopTicker();
}

export function armSleepTrack(): void {
  clearDurationFire();
  const status = usePlaybackStore.getState();
  const content = remainingContentSec(status, "track");
  const remaining = wallSec(content, status.rate);
  useSleepTimerStore.setState({
    kind: "track",
    remainingSec: remaining,
    remainingTrackEnds: 0,
    deadlineAt: Date.now() + remaining * 1000,
    armedTrackId: status.currentTrackId,
    armedIndex: status.currentIndex,
  });
  startTicker();
}

export function armSleepAlbum(): void {
  clearDurationFire();
  const status = usePlaybackStore.getState();
  const content = remainingContentSec(status, "album");
  const remaining = wallSec(content, status.rate);
  useSleepTimerStore.setState({
    kind: "album",
    remainingSec: remaining,
    remainingTrackEnds: 0,
    deadlineAt: Date.now() + remaining * 1000,
    armedTrackId: null,
    armedIndex: null,
  });
  startTicker();
}

export function armSleepDuration(hours: number, minutes: number): void {
  const totalSec = Math.max(0, hours) * 3600 + Math.max(0, minutes) * 60;
  if (totalSec <= 0) {
    return;
  }
  const deadlineAt = Date.now() + totalSec * 1000;
  useSleepTimerStore.setState({
    kind: "duration",
    remainingSec: totalSec,
    remainingTrackEnds: 0,
    deadlineAt,
    armedTrackId: null,
    armedIndex: null,
  });
  // Wall-clock pause when JS timers run. Native progress maybeFire is the
  // backup if RN pauses timers while audio stays alive. 1s tick is the label.
  armDurationFire(deadlineAt);
  startTicker();
}

export function armSleepTracks(count: number): void {
  clearDurationFire();
  // Count includes the current track's remaining end (1 = this track, same as armSleepTrack).
  const n = Math.max(1, Math.floor(count));
  const status = usePlaybackStore.getState();
  const content = remainingContentSec(status, "track");
  const remaining = wallSec(content, status.rate);
  useSleepTimerStore.setState({
    kind: "tracks",
    remainingTrackEnds: n,
    remainingSec: remaining,
    deadlineAt: Date.now() + remaining * 1000,
    armedTrackId: status.currentTrackId,
    armedIndex: status.currentIndex,
  });
  startTicker();
}

export function isSleepArmed(): boolean {
  return useSleepTimerStore.getState().kind !== "off";
}
