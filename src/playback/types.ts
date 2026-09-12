import type { CollectionKind, L10nText, ThemedMediaUrl } from "@/types/catalogue";

export const PLAYBACK_RATE_MIN = 0.25;
export const PLAYBACK_RATE_MAX = 2;
export const PLAYBACK_RATE_STEP = 0.25;
export const DEFAULT_PLAYBACK_RATE = 1;

/** Persist resume off the 1s progress tick. */
export const RESUME_DEBOUNCE_MS = 1000;
export const REMOTE_SKIP_SEC = 10;
/** Drop stale progress ticks after skip/seek while native catches up. */
export const IGNORE_PROGRESS_MS = 1200;
/** User pause rewinds so resume is not mid-word; do not overflow to the previous track. */
export const PAUSE_REWIND_SEC = 2;
/** Native skip-previous restarts the current item after this; keep in-app prev in sync. */
export const SKIP_TO_PREVIOUS_THRESHOLD_SEC = 2;
/** Android `drawable/` name for the media-session small icon (white silhouette). */
export const ANDROID_NOTIFICATION_ICON = "notification_icon";

export type RemotePrimary = "seek" | "skip";
export const DEFAULT_REMOTE_PRIMARY: RemotePrimary = "seek";

export function clampPlaybackRate(rate: number): number {
  if (!Number.isFinite(rate)) {
    return DEFAULT_PLAYBACK_RATE;
  }
  const stepped = Math.round(rate / PLAYBACK_RATE_STEP) * PLAYBACK_RATE_STEP;
  return Math.min(
    PLAYBACK_RATE_MAX,
    Math.max(PLAYBACK_RATE_MIN, Number(stepped.toFixed(2))),
  );
}

export type SessionTrack = {
  id: string;
  /** Playback source; may be `file:` after withLocalUrls. */
  url: string;
  /** Immutable CDN identity; never rewritten to a local path. */
  remoteUrl: string;
  title: L10nText;
  durationSec?: number;
  byteSize?: number;
  startAng?: number;
};

export type PlayerSession = {
  albumId: string;
  reciterName: L10nText;
  scriptureId?: string;
  collectionKind?: CollectionKind;
  artworkUrl?: ThemedMediaUrl;
  tracks: SessionTrack[];
};

export type LoadAlbumOptions = {
  trackId?: string;
  positionSec?: number;
};

export type PlayerStatus = {
  session: PlayerSession | null;
  playing: boolean;
  currentIndex: number;
  currentTrackId: string | null;
  positionSec: number;
  durationSec: number;
  buffering: boolean;
  error: string | null;
  rate: number;
  /** Last track finished; play() must reload from 0 (native play at the last frame is a no-op). */
  albumEnded: boolean;
};

export const idlePlayerStatus: PlayerStatus = {
  session: null,
  playing: false,
  currentIndex: 0,
  currentTrackId: null,
  positionSec: 0,
  durationSec: 0,
  buffering: false,
  error: null,
  rate: DEFAULT_PLAYBACK_RATE,
  albumEnded: false,
};

/** App-facing player. Only the adapter talks to react-native-nitro-player. */
export type PlayerEngine = {
  loadAlbum: (
    session: PlayerSession,
    options?: LoadAlbumOptions,
  ) => Promise<void>;
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  skipTo: (trackId: string) => void;
  seekBy: (deltaSec: number) => Promise<void>;
  seekTo: (positionSec: number) => Promise<void>;
  setRate: (rate: number) => Promise<void>;
  setSkipOnSourceError: (enabled: boolean) => Promise<void>;
  setRemotePrimary: (primary: RemotePrimary) => Promise<void>;
  /** Downloads call via live-queue (dynamic import); patches upcoming URLs without restarting the current item. */
  syncLiveQueueSources: () => void;
  subscribe: (listener: (status: PlayerStatus) => void) => () => void;
  getStatus: () => PlayerStatus;
};
