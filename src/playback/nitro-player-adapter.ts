import { Mutex } from "async-mutex";
import debounce from "lodash/debounce";
import {
  PlayerQueue,
  TrackPlayer,
  type PlayerState,
} from "react-native-nitro-player";
import { AppState, type NativeEventSubscription } from "react-native";

import { pickThemedUrl } from "@/catalogue/themed-url";
import i18n from "@/i18n";
import { isOnline, playableUrlFor, subscribeNetwork } from "@/downloads";
import { attachNativePlayerListeners } from "@/playback/native-listeners";
import {
  freezeSession,
  isNativePlaybackDead,
  persistFromStatus,
  requestNotificationPermission,
  statusFromNative,
  toTrackItems,
  trackInSession,
} from "@/playback/native-status";
import {
  getAlbumRate,
  persistAlbumRate,
  getAlbumResume,
  persistAlbumResume,
} from "@/playback/resume-store";
import { snapshotsEqual, trackIndex, withLocalUrls } from "@/playback/session";
import { usePlaybackStore } from "@/playback/status-store";
import { usePreferencesStore } from "@/state/preferences-store";
import {
  resolvedColorScheme,
  subscribeResolvedColorScheme,
} from "@/theme/use-theme-colors";
import {
  clampPlaybackRate,
  DEFAULT_PLAYBACK_RATE,
  RESUME_DEBOUNCE_MS,
  REMOTE_SKIP_SEC,
  IGNORE_PROGRESS_MS,
  PAUSE_REWIND_SEC,
  ANDROID_NOTIFICATION_ICON,
  DEFAULT_REMOTE_PRIMARY,
  type LoadAlbumOptions,
  type PlayerEngine,
  type PlayerSession,
  type PlayerStatus,
  type RemotePrimary,
} from "@/playback/types";

function clampSeek(positionSec: number, durationSec: number): number {
  const duration = durationSec || 0;
  // Unknown duration: do not clamp to 0 (that would restart the track).
  return Math.min(
    Math.max(0, positionSec),
    duration > 0 ? duration : Math.max(0, positionSec),
  );
}

/** Native PlayerEngine (TrackPlayer + PlayerQueue). Screens and downloads must use getPlayerEngine(); do not import this module directly. */
export function createNitroPlayerEngine(): PlayerEngine {
  let session: PlayerSession | null = null;
  // URLs last sent via loadIntoNative. updateTracks may not apply file→remote on native.
  let nativeSourceUrls: string[] = [];
  let nativePlaylistId: string | null = null;
  let cachedNative: PlayerState | null = null;
  let rate = DEFAULT_PLAYBACK_RATE;
  let appStateSub: NativeEventSubscription | null = null;
  let configured: Promise<void> | null = null;
  let listenersAttached = false;
  // After skip/seek, native can still emit a few stale progress ticks.
  let ignoreProgressUntil = 0;
  let seekAnchorSec = 0;
  // loadPlaylist emits seek/progress before JS session catches up; drop those ticks.
  let queueSwapInFlight = false;
  let lastError: string | null = null;
  let rewoundForThisPause = false;
  let wasPlaying = false;
  // Distinct from native playWhenReady: error/end/pause must not resume on restore.
  let wantsPlaying = false;
  let skipOnSourceError = false;
  let remotePrimary: RemotePrimary = DEFAULT_REMOTE_PRIMARY;
  let skipPauseRewind = false;
  let albumEnded = false;
  const mutex = new Mutex();
  let networkHooked = false;

  function nativePlayerConfig() {
    return {
      androidAutoEnabled: false,
      carPlayEnabled: false,
      showInNotification: true,
      remoteSkipForwardInterval: REMOTE_SKIP_SEC,
      remoteSkipBackwardInterval: REMOTE_SKIP_SEC,
      // Native `onTracksNeedUpdate` when a track.url is empty — not the lock-screen window
      // (that is hardcoded QUEUE_WINDOW_SIZE = 4). This app always sends URLs, so the
      // callback never fires; 1 matches "do not ask JS to fill a window of empties."
      lookaheadCount: 1,
      // PlayerConfig has no extra flags; native configure parses this token.
      androidNotificationIcon: [
        `icon:${ANDROID_NOTIFICATION_ICON}`,
        `skipOnError:${skipOnSourceError ? "1" : "0"}`,
        `remotePrimary:${remotePrimary}`,
        // Native ±10 overflow into https only while online; file: neighbours always overflow.
        `httpOverflow:${isOnline() ? "1" : "0"}`,
      ].join(";"),
    };
  }

  // leading + maxWait so 1s progress ticks still persist; trailing-only would reset forever.
  const debouncedPersist = debounce(
    (status: PlayerStatus) => {
      persistFromStatus(status);
    },
    RESUME_DEBOUNCE_MS,
    { leading: true, trailing: true, maxWait: RESUME_DEBOUNCE_MS },
  );

  function currentStatus(): PlayerStatus {
    return {
      ...statusFromNative(session, cachedNative, rate, lastError),
      albumEnded,
    };
  }

  // cachedNative is our copy. emit() reads fields into a new PlayerStatus; native seek is TrackPlayer.seek.
  function patchCachedTimeline(positionSec: number, durationSec?: number): void {
    if (!cachedNative) {
      return;
    }
    cachedNative.currentPosition = positionSec;
    if (durationSec != null) {
      cachedNative.totalDuration = durationSec;
    }
  }

  function isOfflineStreamNow(): boolean {
    // NetInfo must not JS-pause a healthy buffer; this is only for native stall/error.
    const track = session
      ? trackInSession(session, currentStatus().currentTrackId)
      : undefined;
    return Boolean(track && !isLocalUrl(track.url) && !isOnline());
  }

  function emit(next?: PlayerStatus): void {
    const status = next ?? currentStatus();
    usePlaybackStore.setState(status);
    debouncedPersist(status);
  }

  /** Flush resume immediately (cancel the 1s debounce) and persist this album's rate with it. */
  function persistNow(status: PlayerStatus): void {
    debouncedPersist.cancel();
    persistFromStatus(status);
    if (status.session) {
      persistAlbumRate(status.session.albumId, status.rate);
    }
  }

  function ensureAppState(): void {
    if (appStateSub) {
      return;
    }
    appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") {
        // Process may die; write resume now rather than waiting on the 1s debounce.
        void refreshFromNative().then((status) => {
          if (cachedNative && !isNativePlaybackDead(cachedNative)) {
            persistNow(status);
          }
        });
      }
      if (state === "active") {
        fire(async () => {
          // Stopped at album end is intentional. Rebuilding would seek 0 and drop the replay icon.
          if (albumEnded) {
            return;
          }
          // Audio-focus / service death is not a Play tap. Native shouldResume
          // still runs when ExoPlayer is alive (restore is then a no-op).
          if (isNativePlaybackDead(await readNativeState())) {
            wantsPlaying = false;
          }
          await restoreNativeIfDead();
        });
      }
    });
  }

  // Native ±10 has no NetInfo; flip `httpOverflow` so shade/lock-screen leftover
  // still streams while online and clamps onto https only while offline.
  function hookNetworkPlayerConfig(): void {
    if (networkHooked) {
      return;
    }
    networkHooked = true;
    subscribeNetwork(() => {
      if (!configured) {
        return;
      }
      void TrackPlayer.configure(nativePlayerConfig());
    });
  }

  async function readNativeRate(): Promise<void> {
    try {
      rate = clampPlaybackRate(await TrackPlayer.getPlaybackSpeed());
    } catch {
      // Keep the last known rate if native read fails.
    }
  }

  async function applyAlbumRate(albumId: string): Promise<void> {
    const saved = getAlbumRate(albumId);
    await TrackPlayer.setPlaybackSpeed(saved);
    rate = saved;
  }

  async function refreshFromNative(): Promise<PlayerStatus> {
    try {
      cachedNative = await TrackPlayer.getState();
    } catch {
      // Released exo throws; keep the last track so the mini player stays up.
      cachedNative = {
        currentTrack: cachedNative?.currentTrack ?? null,
        currentPosition: cachedNative?.currentPosition ?? 0,
        totalDuration: 0,
        currentState: "stopped",
        currentPlaylistId: cachedNative?.currentPlaylistId ?? null,
        currentIndex: cachedNative?.currentIndex ?? -1,
        currentPlayingType: "not-playing",
      };
    }
    await readNativeRate();
    const status = currentStatus();
    emit(status);
    return status;
  }

  function attachListeners(): void {
    if (listenersAttached) {
      return;
    }
    listenersAttached = true;
    attachNativePlayerListeners({
      shouldIgnoreNative: () => queueSwapInFlight,
      onTrackChange: () => {
        // Lock-screen prev/next land here too — they never call engine.previous/next.
        ignoreProgressUntil = Date.now() + IGNORE_PROGRESS_MS;
        seekAnchorSec = 0;
        if (queueSwapInFlight) {
          return;
        }
        fire(async () => {
          albumEnded = false;
          const status = await refreshFromNative();
          if (cachedNative && !isNativePlaybackDead(cachedNative)) {
            persistNow(status);
          }
          await reloadIfCurrentSourceStale();
        });
      },
      onPlaybackStateChange: (nativeState, reason) => {
        if (reason === "error") {
          lastError = isOfflineStreamNow()
            ? i18n.t("player.offlineStreamError")
            : i18n.t("player.playbackError");
          void (async () => {
            await refreshFromNative();
            await maybeFallbackMissingLocal();
            if (lastError) {
              wantsPlaying = false;
            }
          })();
        } else if (reason === "end") {
          wantsPlaying = false;
          albumEnded = true;
          const ended = currentStatus();
          if (session && ended.currentTrackId) {
            // Native is stopped, so persistNow below skips. Keep the last frame —
            // writing 0 looks like the last track never started. play() restarts
            // from 0 when albumEnded / atEnd.
            persistAlbumResume(session.albumId, {
              trackId: ended.currentTrackId,
              positionSec:
                ended.durationSec > 0
                  ? ended.durationSec
                  : ended.positionSec,
              updatedAt: Date.now(),
              ...(ended.durationSec > 0
                ? { durationSec: ended.durationSec }
                : {}),
            });
          }
        } else if (nativeState === "playing") {
          lastError = null;
          // Native shouldResume after a call never goes through engine.play().
          wantsPlaying = true;
        } else if (nativeState === "buffering" && isOfflineStreamNow()) {
          // Stall after the buffer empties — do not JS-pause while native is still playing.
          lastError = i18n.t("player.offlineStreamError");
          wantsPlaying = false;
        } else if (nativeState === "buffering") {
          lastError = null;
        }
        void refreshFromNative().then(async (status) => {
          const pausedNow =
            wasPlaying && !status.playing && !status.buffering;
          wasPlaying = status.playing;
          if (status.playing) {
            rewoundForThisPause = false;
          }
          // Ended/error map to stopped; seeking then would restart the last seconds.
          if (
            pausedNow &&
            !rewoundForThisPause &&
            nativeState === "paused" &&
            !skipPauseRewind
          ) {
            rewoundForThisPause = true;
            await applyPauseRewind();
            await applyUpcomingSourceUpdates();
            return;
          }
          if (
            nativeState === "buffering" &&
            isOfflineStreamNow() &&
            (status.playing || status.buffering)
          ) {
            // Stall pause is not a user pause — skip the 2s audiobook rewind.
            skipPauseRewind = true;
            await TrackPlayer.pause();
            persistNow(currentStatus());
            emit();
            return;
          }
          // Offline/missing-file pauses must not look like a user pause (no 2s rewind).
          skipPauseRewind = false;
          if (
            !status.playing &&
            cachedNative &&
            !isNativePlaybackDead(cachedNative)
          ) {
            persistNow(status);
            await applyUpcomingSourceUpdates();
          }
        });
      },
      onProgress: (position, totalDuration) => {
        if (!cachedNative) {
          return;
        }
        if (
          session &&
          cachedNative.currentTrack?.id &&
          !trackInSession(session, cachedNative.currentTrack.id)
        ) {
          return;
        }
        if (
          Date.now() < ignoreProgressUntil &&
          Math.abs(position - seekAnchorSec) > 3
        ) {
          return;
        }
        patchCachedTimeline(position, totalDuration);
        emit();
      },
      onSeek: (position, totalDuration) => {
        if (!cachedNative) {
          return;
        }
        if (
          session &&
          cachedNative.currentTrack?.id &&
          !trackInSession(session, cachedNative.currentTrack.id)
        ) {
          return;
        }
        seekAnchorSec = position;
        ignoreProgressUntil = Date.now() + IGNORE_PROGRESS_MS;
        patchCachedTimeline(position, totalDuration);
        persistNow(currentStatus());
        emit();
      },
    });
    i18n.on("languageChanged", (lng: string) => {
      if (!session) {
        return;
      }
      const tracks = toTrackItems(session, lng);
      fire(async () => {
        await TrackPlayer.updateTracks(tracks);
      });
    });
    // Lock-screen art follows in-app theme; same updateTracks path as language change.
    subscribeResolvedColorScheme(() => {
      if (!session) {
        return;
      }
      const tracks = toTrackItems(session);
      fire(async () => {
        await TrackPlayer.updateTracks(tracks);
      });
    });
  }

  async function applyPauseRewind(): Promise<void> {
    // Audiobook-style overlap: persist a little before the pause so resume is not mid-word.
    const state = await readNativeState();
    if (!state || state.currentState === "playing") {
      return;
    }
    const next = Math.max(0, state.currentPosition - PAUSE_REWIND_SEC);
    if (next >= state.currentPosition - 0.05) {
      persistNow(currentStatus());
      return;
    }
    seekAnchorSec = next;
    ignoreProgressUntil = Date.now() + IGNORE_PROGRESS_MS;
    await TrackPlayer.seek(next);
    patchCachedTimeline(next);
    persistNow(currentStatus());
    emit();
  }

  async function seekByOverflowing(deltaSec: number): Promise<void> {
    // Leftover ±10 at a track edge lands on the neighbour; first/last tracks clamp.
    const state = await TrackPlayer.getState();
    const live = session;
    const index = state.currentIndex;
    const position = state.currentPosition;
    const duration =
      state.totalDuration ||
      (live && index >= 0 ? (live.tracks[index]?.durationSec ?? 0) : 0);
    const target = position + deltaSec;

    if (deltaSec < 0 && target < 0 && live && index > 0) {
      const overflow = -target;
      const resolved = withLocalUrls(live);
      const prev = resolved.tracks[index - 1];
      if (prev && !neighbourPlayableWhileOffline(prev)) {
        const next = clampSeek(0, duration);
        seekAnchorSec = next;
        ignoreProgressUntil = Date.now() + IGNORE_PROGRESS_MS;
        await TrackPlayer.seek(next);
        patchCachedTimeline(next);
        return;
      }
      const prevDur = prev?.durationSec ?? 0;
      const pos = Math.max(0, prevDur - overflow);
      if (prev && prev.url !== nativeSourceUrls[index - 1]) {
        lastError = null;
        await loadIntoNative(resolved, { trackId: prev.id, positionSec: pos });
        if (wantsPlaying) {
          await TrackPlayer.play();
        }
        seekAnchorSec = pos;
        ignoreProgressUntil = Date.now() + IGNORE_PROGRESS_MS;
        return;
      }
      await applyUpcomingSourceUpdates();
      await TrackPlayer.skipToIndex(index - 1);
      if (pos > 0) {
        await TrackPlayer.seek(pos);
      }
      seekAnchorSec = pos;
      ignoreProgressUntil = Date.now() + IGNORE_PROGRESS_MS;
      return;
    }
    if (
      deltaSec > 0 &&
      duration > 0 &&
      target > duration &&
      live &&
      index >= 0 &&
      index < live.tracks.length - 1
    ) {
      const leftover = target - duration;
      const resolved = withLocalUrls(live);
      const nextTrack = resolved.tracks[index + 1];
      if (nextTrack && !neighbourPlayableWhileOffline(nextTrack)) {
        const next = clampSeek(duration, duration);
        seekAnchorSec = next;
        ignoreProgressUntil = Date.now() + IGNORE_PROGRESS_MS;
        await TrackPlayer.seek(next);
        patchCachedTimeline(next);
        return;
      }
      if (nextTrack && nextTrack.url !== nativeSourceUrls[index + 1]) {
        lastError = null;
        await loadIntoNative(resolved, {
          trackId: nextTrack.id,
          positionSec: leftover,
        });
        if (wantsPlaying) {
          await TrackPlayer.play();
        }
        seekAnchorSec = leftover;
        ignoreProgressUntil = Date.now() + IGNORE_PROGRESS_MS;
        return;
      }
      await applyUpcomingSourceUpdates();
      await TrackPlayer.skipToIndex(index + 1);
      if (leftover > 0) {
        await TrackPlayer.seek(leftover);
      }
      seekAnchorSec = leftover;
      ignoreProgressUntil = Date.now() + IGNORE_PROGRESS_MS;
      return;
    }

    const next = clampSeek(target, duration);
    seekAnchorSec = next;
    ignoreProgressUntil = Date.now() + IGNORE_PROGRESS_MS;
    await TrackPlayer.seek(next);
    patchCachedTimeline(next);
  }

  function isLocalUrl(url: string): boolean {
    return url.startsWith("file:");
  }

  // Online: overflow onto streams. Offline: only onto a local file (downloaded).
  function neighbourPlayableWhileOffline(track: {
    id: string;
    url: string;
    remoteUrl: string;
  }): boolean {
    if (isOnline()) {
      return true;
    }
    return (
      isLocalUrl(track.url) || playableUrlFor(track.id, track.remoteUrl) != null
    );
  }

  function desiredUrl(track: { id: string; remoteUrl: string }): string {
    return playableUrlFor(track.id, track.remoteUrl) ?? track.remoteUrl;
  }

  // Pin the playing item so a finished download does not restart the current stream.
  function withLocalUrlsPinnedCurrent(
    live: PlayerSession,
    currentTrackId: string | null,
  ): PlayerSession {
    const resolved = withLocalUrls(live);
    if (!currentTrackId) {
      return resolved;
    }
    const frozen = currentTrackId
      ? trackInSession(live, currentTrackId)
      : undefined;
    if (!frozen) {
      return resolved;
    }
    return {
      ...resolved,
      tracks: resolved.tracks.map((track) =>
        track.id === currentTrackId ? { ...track, url: frozen.url } : track,
      ),
    };
  }

  /** Patch upcoming URLs after a download; pin the playing item so it is not restarted. Reload the current item only while paused. */
  async function applyUpcomingSourceUpdates(): Promise<void> {
    if (!session) {
      return;
    }
    const status = currentStatus();
    const merged = status.playing
      ? withLocalUrlsPinnedCurrent(session, status.currentTrackId)
      : withLocalUrls(session);
    if (snapshotsEqual(session, merged)) {
      return;
    }
    await ensureConfigured();
    const currentId = status.currentTrackId;
    const previousUrl = currentId
      ? trackInSession(session, currentId)?.url
      : undefined;
    const nextUrl = currentId
      ? trackInSession(merged, currentId)?.url
      : undefined;
    // Native updateTracks will not change the current item's URL; reload while paused instead.
    if (!status.playing && currentId && previousUrl !== nextUrl) {
      skipPauseRewind = true;
      await loadIntoNative(merged, {
        trackId: currentId,
        positionSec: status.positionSec,
      });
      try {
        await TrackPlayer.pause();
      } catch {
        // Fresh load may already be paused.
      }
      return;
    }
    session = freezeSession(merged);
    await TrackPlayer.updateTracks(toTrackItems(session));
  }

  // onTrackChange is after native already started this item — rebuild if native URL is stale.
  async function reloadIfCurrentSourceStale(): Promise<void> {
    if (!session || queueSwapInFlight) {
      return;
    }
    const status = currentStatus();
    const index = status.currentIndex;
    const track = trackInSession(session, status.currentTrackId);
    if (!track || index < 0 || index >= nativeSourceUrls.length) {
      return;
    }
    const wanted = desiredUrl(track);
    // Compare the URL we last loaded, not nitro's currentTrack.url — that field
    // often disagrees and would rebuild the queue on every track change.
    if (nativeSourceUrls[index] === wanted && track.url === wanted) {
      return;
    }
    const positionSec = status.positionSec < 1 ? 0 : status.positionSec;
    skipPauseRewind = true;
    await loadIntoNative(withLocalUrls(session), {
      trackId: track.id,
      positionSec,
    });
    if (wantsPlaying) {
      await TrackPlayer.play();
    }
  }

  /** Native skip only when the target URL matches what we last loaded; otherwise reload so a new file: path is used. */
  async function skipToResolvedIndex(
    index: number,
    nativeSkip: () => Promise<unknown>,
  ): Promise<void> {
    if (!session) {
      return;
    }
    // Next on the last track (or prev on the first) must not rebuild the playing item.
    if (index === currentStatus().currentIndex) {
      await applyUpcomingSourceUpdates();
      await nativeSkip();
      return;
    }
    const resolved = withLocalUrls(session);
    const target = resolved.tracks[index];
    if (target && target.url !== nativeSourceUrls[index]) {
      lastError = null;
      await loadIntoNative(resolved, { trackId: target.id, positionSec: 0 });
      if (wantsPlaying) {
        await TrackPlayer.play();
      }
      return;
    }
    await applyUpcomingSourceUpdates();
    await nativeSkip();
  }

  // Disk file vanished (user/OS) or native still holds a deleted file URL after updateTracks.
  async function maybeFallbackMissingLocal(): Promise<void> {
    const live = session;
    const status = currentStatus();
    const track = live
      ? trackInSession(live, status.currentTrackId)
      : undefined;
    if (!live || !track) {
      return;
    }
    const wanted = desiredUrl(track);
    const held =
      status.currentIndex >= 0 && nativeSourceUrls[status.currentIndex]
        ? nativeSourceUrls[status.currentIndex]
        : track.url;
    if (held === wanted && track.url === wanted) {
      return;
    }
    const missingFile = isLocalUrl(held) || isLocalUrl(track.url);
    if (missingFile && playableUrlFor(track.id, track.remoteUrl)) {
      return;
    }
    if (!isOnline() && playableUrlFor(track.id, track.remoteUrl) == null) {
      lastError = i18n.t("player.offlineStreamError");
      emit();
      return;
    }
    const positionSec = status.positionSec;
    skipPauseRewind = true;
    await enqueue(async () => {
      await loadIntoNative(withLocalUrls(live), { trackId: track.id, positionSec });
      lastError = null;
      if (wantsPlaying) {
        await TrackPlayer.play();
      }
    });
  }

  /** Serialize native commands; TrackPlayer is not reentrant (load vs skip vs seek). */
  function enqueue(task: () => Promise<void>): Promise<void> {
    return mutex.runExclusive(task);
  }

  /** Run on the native mutex without awaiting; refresh status if the command throws so the UI does not stay stale. */
  function fire(task: () => Promise<void>): void {
    void enqueue(task).catch(() => {
      void refreshFromNative();
    });
  }

  async function ensureConfigured(): Promise<void> {
    if (!configured) {
      configured = (async () => {
        // Wizard has not asked yet; a runtime prompt here would interrupt onboarding.
        if (usePreferencesStore.getState().hasCompletedWizard) {
          await requestNotificationPermission();
        }
        await TrackPlayer.configure(nativePlayerConfig());
        await TrackPlayer.setRepeatMode("off");
        attachListeners();
        ensureAppState();
        hookNetworkPlayerConfig();
      })().catch((error: unknown) => {
        configured = null;
        throw error;
      });
    }
    await configured;
  }

  /** Configure + rebuild a dead ExoPlayer before a command so play() is not a no-op. */
  async function withNativeReady<T>(action: () => Promise<T>): Promise<T> {
    await ensureConfigured();
    await restoreNativeIfDead();
    return action();
  }

  async function pruneOtherPlaylists(keepId: string): Promise<void> {
    const playlists = PlayerQueue.getAllPlaylists();
    await Promise.all(
      playlists
        .filter((playlist) => playlist.id !== keepId)
        .map((playlist) => PlayerQueue.deletePlaylist(playlist.id)),
    );
  }

  async function applyStartPosition(
    nextSession: PlayerSession,
    options?: LoadAlbumOptions,
  ): Promise<void> {
    // Same album already loaded — seek/skip in place instead of rebuilding the native playlist.
    const index =
      options?.trackId != null
        ? trackIndex(nextSession, options.trackId)
        : await TrackPlayer.getCurrentTrackIndex();
    const startIndex = index >= 0 ? index : 0;
    const currentIndex = await TrackPlayer.getCurrentTrackIndex();
    if (startIndex !== currentIndex) {
      await TrackPlayer.skipToIndex(startIndex);
    }
    const positionSec = options?.positionSec;
    if (positionSec != null && positionSec >= 0) {
      await TrackPlayer.seek(positionSec);
    }
  }

  /** Rebuild start: last-frame replay from 0; else live position, then stored resume for the same track. */
  function resumeLoadOptions(): LoadAlbumOptions | undefined {
    if (!session || session.tracks.length === 0) {
      return undefined;
    }
    const status = currentStatus();
    const stored = getAlbumResume(session.albumId);
    const trackId =
      status.currentTrackId ?? stored?.trackId ?? session.tracks[0]?.id;
    const atEnd =
      !status.playing &&
      status.durationSec > 0 &&
      status.positionSec >= status.durationSec - 0.75;
    const positionSec = atEnd
      ? 0
      : status.positionSec > 0
        ? status.positionSec
        : stored?.trackId === trackId
          ? (stored?.positionSec ?? 0)
          : 0;
    return { trackId, positionSec };
  }

  async function readNativeState(): Promise<PlayerState | null> {
    try {
      return await TrackPlayer.getState();
    } catch {
      return null;
    }
  }

  async function rebuildNativeFromSession(
    options = resumeLoadOptions(),
  ): Promise<void> {
    if (!session) {
      return;
    }
    // playSong always starts playback. Reload paused unless the user still wants play.
    await loadIntoNative(session, options);
    if (wantsPlaying) {
      await TrackPlayer.play();
    } else {
      try {
        await TrackPlayer.pause();
      } catch {
        // Fresh load may already be paused.
      }
    }
  }

  async function restoreNativeIfDead(): Promise<void> {
    if (!session) {
      return;
    }
    if (!isNativePlaybackDead(await readNativeState())) {
      return;
    }
    await rebuildNativeFromSession();
  }

  async function loadIntoNative(
    nextSession: PlayerSession,
    options?: LoadAlbumOptions,
  ): Promise<void> {
    await ensureConfigured();
    albumEnded = false;
    const outgoing = currentStatus();
    queueSwapInFlight = true;
    ignoreProgressUntil = Date.now() + 2000;
    seekAnchorSec = options?.positionSec ?? 0;
    try {
      if (
        outgoing.session &&
        outgoing.session.albumId !== nextSession.albumId
      ) {
        persistNow(outgoing);
      }
      const frozen = freezeSession(nextSession);
      // Point JS at the incoming album before native load so stale ticks cannot
      // write the new timeline onto the outgoing album id.
      session = frozen;
      nativeSourceUrls = frozen.tracks.map((track) => track.url);
      const tracks = toTrackItems(frozen);
      const playlistId = await PlayerQueue.createPlaylist(
        frozen.albumId,
        undefined,
        pickThemedUrl(frozen.artworkUrl, resolvedColorScheme()),
      );
      await PlayerQueue.addTracksToPlaylist(playlistId, tracks);
      await TrackPlayer.setRepeatMode("off");
      const index =
        options?.trackId != null ? trackIndex(frozen, options.trackId) : 0;
      const startIndex = index >= 0 ? index : 0;
      // Pass startIndex here. loadPlaylist(0) then skipToIndex still windows ExoPlayer from N.
      await PlayerQueue.loadPlaylist(playlistId, startIndex);
      const positionSec = options?.positionSec ?? 0;
      if (positionSec > 0) {
        await TrackPlayer.seek(positionSec);
      }
      await applyAlbumRate(frozen.albumId);
      nativePlaylistId = playlistId;
      try {
        await pruneOtherPlaylists(playlistId);
      } catch {
        // Leftover native playlists are not the session source of truth.
      }
      await refreshFromNative();
    } finally {
      queueSwapInFlight = false;
    }
  }

  const engine: PlayerEngine = {
    async loadAlbum(nextSession, options) {
      await enqueue(async () => {
        if (
          session &&
          nativePlaylistId &&
          snapshotsEqual(session, nextSession)
        ) {
          // Same track ids/urls — keep the frozen native queue (catalogue refresh must not rebuild it).
          await ensureConfigured();
          if (isNativePlaybackDead(await readNativeState())) {
            await loadIntoNative(nextSession, options ?? resumeLoadOptions());
            return;
          }
          await applyStartPosition(session, options);
          await applyAlbumRate(session.albumId);
          await refreshFromNative();
          return;
        }
        await loadIntoNative(nextSession, options);
      });
    },
    play() {
      fire(async () => {
        const track = session
          ? trackInSession(session, currentStatus().currentTrackId)
          : undefined;
        if (track && !isOnline() && playableUrlFor(track.id, track.remoteUrl) == null) {
          lastError = i18n.t("player.offlineStreamError");
          wantsPlaying = false;
          emit();
          return;
        }
        lastError = null;
        wantsPlaying = true;
        albumEnded = false;
        const options = resumeLoadOptions();
        const status = currentStatus();
        // Native play() at the last frame is a no-op; reload from 0 first.
        const atEnd =
          !status.playing &&
          status.durationSec > 0 &&
          status.positionSec >= status.durationSec - 0.75;
        try {
          if (atEnd || isNativePlaybackDead(cachedNative)) {
            await rebuildNativeFromSession(options);
          }
          await withNativeReady(() => TrackPlayer.play());
        } catch {
          await rebuildNativeFromSession(options);
          await TrackPlayer.play();
        }
        const after = await refreshFromNative();
        if (
          session &&
          !after.playing &&
          !after.buffering &&
          isNativePlaybackDead(cachedNative)
        ) {
          await rebuildNativeFromSession(options);
          await TrackPlayer.play();
          await refreshFromNative();
        }
      });
    },
    pause() {
      fire(async () => {
        wantsPlaying = false;
        await ensureConfigured();
        await TrackPlayer.pause();
        persistNow(await refreshFromNative());
        await applyUpcomingSourceUpdates();
      });
    },
    next() {
      fire(async () => {
        if (!session) {
          return;
        }
        const nextIndex = Math.min(
          currentStatus().currentIndex + 1,
          session.tracks.length - 1,
        );
        await skipToResolvedIndex(nextIndex, () =>
          withNativeReady(() => TrackPlayer.skipToNext()),
        );
        persistNow(await refreshFromNative());
      });
    },
    previous() {
      fire(async () => {
        if (!session) {
          return;
        }
        const prevIndex = Math.max(0, currentStatus().currentIndex - 1);
        await skipToResolvedIndex(prevIndex, () =>
          withNativeReady(() => TrackPlayer.skipToPrevious()),
        );
        persistNow(await refreshFromNative());
      });
    },
    skipTo(trackId) {
      fire(async () => {
        if (!session) {
          return;
        }
        const index = trackIndex(session, trackId);
        if (index < 0) {
          return;
        }
        await skipToResolvedIndex(index, () =>
          withNativeReady(() => TrackPlayer.skipToIndex(index)),
        );
        persistNow(await refreshFromNative());
      });
    },
    async seekBy(deltaSec) {
      await enqueue(async () => {
        await withNativeReady(async () => {
          await seekByOverflowing(deltaSec);
        });
        await refreshFromNative();
      });
    },
    async seekTo(positionSec) {
      await enqueue(async () => {
        await withNativeReady(async () => {
          const state = await TrackPlayer.getState();
          const next = clampSeek(positionSec, state.totalDuration);
          seekAnchorSec = next;
          ignoreProgressUntil = Date.now() + IGNORE_PROGRESS_MS;
          await TrackPlayer.seek(next);
          // getState() can still return the pre-seek position; keep the thumb put.
          patchCachedTimeline(next);
        });
        emit();
      });
    },
    async setRate(nextRate) {
      await enqueue(async () => {
        await ensureConfigured();
        const clamped = clampPlaybackRate(nextRate);
        await TrackPlayer.setPlaybackSpeed(clamped);
        rate = clamped;
        if (session) {
          persistAlbumRate(session.albumId, clamped);
        }
        await refreshFromNative();
      });
    },
    async setSkipOnSourceError(enabled) {
      await enqueue(async () => {
        skipOnSourceError = enabled;
        await ensureConfigured();
        await TrackPlayer.configure(nativePlayerConfig());
      });
    },
    async setRemotePrimary(primary) {
      await enqueue(async () => {
        remotePrimary = primary === "skip" ? "skip" : "seek";
        await ensureConfigured();
        await TrackPlayer.configure(nativePlayerConfig());
      });
    },
    syncLiveQueueSources() {
      fire(async () => {
        await applyUpcomingSourceUpdates();
      });
    },
    subscribe(listener) {
      listener(usePlaybackStore.getState());
      return usePlaybackStore.subscribe((status) => listener(status));
    },
    getStatus: currentStatus,
  };

  ensureAppState();
  return engine;
}
