import {
  getCollectionById,
  getReciterById,
  getScriptureById,
  getTrackInCollection,
  loadCatalogue,
} from "@/catalogue";
import { getPlayerEngine } from "@/playback/engine";
import { initSleepTimer } from "@/playback/sleep-timer";
import {
  getSessionTrack,
  isLocalPlaybackUrl,
  sessionFromCollection,
  withLocalUrls,
} from "@/playback/session";
import { usePlaybackStore } from "@/playback/status-store";
import {
  getAlbumResume,
  isEndedAlbumResume,
} from "@/playback/resume-store";
import type { LoadAlbumOptions, PlayerSession, RemotePrimary, SessionTrack } from "@/playback/types";
import { isOnline, playableUrlFor } from "@/downloads";
import i18n from "@/i18n";
import { recordHistoryPlay, useHistoryStore } from "@/state/history-store";

export { usePlaybackStore } from "@/playback/status-store";

let started = false;

export function initPlayback(): void {
  if (started) {
    return;
  }
  started = true;
  initSleepTimer();
  let lastHistoryKey = "";
  // Identity only — lock-screen skip is included; pause/seek on the same track is not.
  getPlayerEngine().subscribe((status) => {
    if (!status.session || !status.currentTrackId) {
      return;
    }
    const key = `${status.session.albumId}:${status.currentTrackId}`;
    if (key === lastHistoryKey) {
      return;
    }
    lastHistoryKey = key;
    recordHistoryPlay(status.session.albumId, status.currentTrackId);
  });
}

export function trackAvailableOffline(track: SessionTrack): boolean {
  // `url` may still be https while a file exists (pinned current); playableUrlFor is the disk check.
  return (
    isLocalPlaybackUrl(track.url) ||
    playableUrlFor(track.id, track.remoteUrl) != null
  );
}

/** Rebuild the last album into native paused so the mini-player survives process death. */
export async function restoreLastSession(): Promise<void> {
  const engine = getPlayerEngine();
  if (engine.getStatus().session) {
    return;
  }
  // Newest listen, not a scan of resume.updatedAt — same album the mini-player had.
  const albumId = useHistoryStore.getState().items[0]?.albumId;
  if (!albumId) {
    return;
  }
  const catalogue = loadCatalogue();
  const collection = getCollectionById(catalogue, albumId);
  if (!collection?.tracks.length) {
    return;
  }
  const resume = getAlbumResume(albumId);
  const resumeTrack = resume
    ? getTrackInCollection(catalogue, albumId, resume.trackId)
    : undefined;
  const start = resumeTrack ?? collection.tracks[0];
  if (!start) {
    return;
  }
  const lastTrack = collection.tracks[collection.tracks.length - 1];
  const ended =
    resume != null &&
    resumeTrack != null &&
    isEndedAlbumResume(
      resume,
      lastTrack?.id,
      resume.durationSec ??
        ("durationSec" in start ? start.durationSec : undefined),
      false,
    );
  const reciter = collection.reciterId
    ? getReciterById(catalogue, collection.reciterId)
    : undefined;
  const scripture = collection.scriptureId
    ? getScriptureById(catalogue, collection.scriptureId)
    : undefined;
  try {
    // loadAlbum only — playAlbum would autoplay after a kill from a call / other app.
    await engine.loadAlbum(
      withLocalUrls(sessionFromCollection(collection, reciter, scripture)),
      {
        trackId: start.id,
        positionSec:
          ended || !resume || !resumeTrack ? 0 : resume.positionSec,
      },
    );
  } catch {
    // Mini-player stays hidden; album and history resume still work.
  }
}

/** Loads and plays. Returns false while offline with no file — caller must not open Now Playing. */
export async function playAlbum(
  session: PlayerSession,
  options?: LoadAlbumOptions,
): Promise<boolean> {
  const resolved = withLocalUrls(session);
  const startId = options?.trackId ?? resolved.tracks[0]?.id;
  const start = startId ? getSessionTrack(resolved, startId) : undefined;
  if (
    start &&
    !isOnline() &&
    playableUrlFor(start.id, start.remoteUrl) == null
  ) {
    // Do not load native — play() would no-op and look like a hang.
    usePlaybackStore.setState({ error: i18n.t("player.offlineStreamError") });
    return false;
  }
  const engine = getPlayerEngine();
  await engine.loadAlbum(resolved, options);
  engine.play();
  return true;
}

export function togglePlayPause(): void {
  const engine = getPlayerEngine();
  const status = engine.getStatus();
  if (status.playing) {
    engine.pause();
    return;
  }
  // Adapter play() uses playableUrlFor so a finished download is resumeable
  // even if pause has not unpinned the frozen https URL yet.
  engine.play();
}

export function pausePlayback(): void {
  getPlayerEngine().pause();
}

export function setPlaybackRate(rate: number): void {
  void getPlayerEngine().setRate(rate);
}

export function skipNext(): void {
  const engine = getPlayerEngine();
  const status = engine.getStatus();
  const next = status.session?.tracks[status.currentIndex + 1];
  // Stay on the current item; skipping into an undownloaded stream would replace a playable track.
  if (next && !isOnline() && !trackAvailableOffline(next)) {
    return;
  }
  engine.next();
}

export function skipPrevious(): void {
  const engine = getPlayerEngine();
  const status = engine.getStatus();
  const prev = status.session?.tracks[status.currentIndex - 1];
  // Stay on the current item; skipping into an undownloaded stream would replace a playable track.
  if (prev && !isOnline() && !trackAvailableOffline(prev)) {
    return;
  }
  engine.previous();
}

export function skipToTrack(trackId: string): void {
  const engine = getPlayerEngine();
  const session = engine.getStatus().session;
  const track = session ? getSessionTrack(session, trackId) : undefined;
  // Same gate as skip next/prev — do not jump to an undownloaded stream while offline.
  if (track && !isOnline() && !trackAvailableOffline(track)) {
    return;
  }
  engine.skipTo(trackId);
}

export function seekBy(deltaSec: number): void {
  void getPlayerEngine().seekBy(deltaSec);
}

export function seekTo(positionSec: number): void {
  void getPlayerEngine().seekTo(positionSec);
}

export function setSkipOnSourceError(enabled: boolean): void {
  void getPlayerEngine().setSkipOnSourceError(enabled);
}

export function setRemotePrimary(primary: RemotePrimary): void {
  void getPlayerEngine().setRemotePrimary(primary);
}

export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
