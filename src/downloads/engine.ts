import {
  completeHandler,
  createDownloadTask,
  getExistingDownloadTasks,
  setConfig,
  type DownloadTask,
} from "@kesha-antonov/react-native-background-downloader";
import { Alert, AppState, Platform } from "react-native";
import { Mutex } from "async-mutex";

import {
  catalogueAllTrackIds,
  getCollectionById,
  getReciterById,
  getTrackInCollection,
  resolveL10n,
  useCatalogueStore,
} from "@/catalogue";
import {
  fileForTrackOnAlbum,
  batchSnapshotForAlbum,
  filesForTrack,
  flushDeferredDownloadsPersist,
  getFile,
  isTrackDownloaded,
  isTrackDownloading,
  refreshBatchesFromFiles,
  useDownloadStore,
} from "@/downloads/store";
import { isCellular, isOnline, subscribeNetwork } from "@/downloads/network";
import {
  albumIdFromDownloadNotificationId,
  albumNotificationId,
  cancelDownloadNotification,
  dismissLibraryDownloadNotifications,
  dismissStaleDownloadNotifications,
  displayedDownloadNotificationIds,
  initDownloadNotifications,
  isAlbumNotificationId,
  isTrackNotificationId,
  relocalizeDownloadChannel,
  showCompleteNotification,
  showProgressNotification,
  trackIdFromDownloadNotificationId,
  trackNotificationId,
} from "@/downloads/notify";
import {
  availableBytes,
  deleteLocalFile,
  destinationPath,
  downloadedBytesOnDisk,
  ensureAudioDirectory,
  playableUri,
} from "@/downloads/paths";
import {
  fileKey as makeKey,
  type DownloadFile,
  type DownloadTrackInput,
  type EnqueueMode,
} from "@/downloads/types";
import i18n from "@/i18n";
import { usePlaybackStore } from "@/playback/status-store";
import { usePreferencesStore } from "@/state/preferences-store";

// Catalogue byteSize can undershoot; 50 MB keeps enqueue from filling the last of the disk.
const STORAGE_MARGIN_BYTES = 50 * 1024 * 1024;
const NOTIFY_THROTTLE_MS = 800;
// Android UIDT: starting more than this fails silently. iOS stays 1 always so
// lock-screen play after a paused dump cannot run 3 CDN transfers next to AVPlayer.
const MAX_PARALLEL_DOWNLOADS = 3;
const PROGRESS_INTERVAL_MS = 1000;
const PROGRESS_MIN_BYTES = 1_048_576;

let pendingAlbumNoticeId: string | null = null;
const iosIndeterminateAlbumIds = new Set<string>();
const iosIndeterminateTrackIds = new Set<string>();

function iosPlaybackBusy(): boolean {
  if (Platform.OS !== "ios") {
    return false;
  }
  const status = usePlaybackStore.getState();
  return status.playing || status.buffering;
}

/** Percent / done-total only while paused with a live media session; else "Downloading…". */
function iosCanShowDownloadProgress(): boolean {
  if (Platform.OS !== "ios") {
    return false;
  }
  const status = usePlaybackStore.getState();
  return Boolean(status.session) && !status.playing && !status.buffering;
}

function iosProgressGateFromStatus(status: {
  session: unknown;
  playing: boolean;
  buffering: boolean;
}): boolean {
  return Boolean(status.session) && !status.playing && !status.buffering;
}

function trackProgressPercent(trackId: string): number {
  const live = useDownloadStore.getState().progress[trackId];
  if (!live || live.bytesTotal <= 0) {
    return 0;
  }
  return (live.bytesDownloaded / live.bytesTotal) * 100;
}

/** Force-refresh every live shade after the iOS progress gate flips. */
function refreshLiveDownloadNotices(): void {
  pendingAlbumNoticeId = null;
  for (const notice of [...liveNotices.values()]) {
    if (notice.kind === "album") {
      void notifyAlbum(notice.albumId, true);
      continue;
    }
    if (!notice.trackId) {
      continue;
    }
    void notifyTrack(
      notice.trackId,
      notice.title,
      notice.reciterName,
      trackProgressPercent(notice.trackId),
      notice.albumId,
      true,
    );
  }
}

function maxParallelDownloads(): number {
  return Platform.OS === "ios" ? 1 : MAX_PARALLEL_DOWNLOADS;
}

function hasUnheldLeftover(): boolean {
  const held = playbackHeldTrackIds();
  return inFlightDownloadFiles().some((file) => !held.has(file.trackId));
}

function notifyDownloadsPausedForPlayback(): void {
  if (inFlightDownloadFiles().length === 0 || hasUnheldLeftover()) {
    return;
  }
  useDownloadStore.getState().showSnackbar({
    kind: "pausedForPlayback",
    count: 0,
  });
}

// Init, enqueue, and cancel share native job ids; overlapping calls would double-start.
const mutex = new Mutex();

type LiveNotice = {
  kind: "album" | "track";
  albumId: string;
  trackId?: string;
  title: string;
  reciterName?: string;
  percent: number;
};

type AlbumBatch = {
  pending: Set<string>;
  total: number;
  done: number;
  title: string;
};

type TaskMeta = {
  albumId: string;
  trackId: string;
  remoteUrl: string;
  mode: EnqueueMode;
};

type PumpItem = DownloadTrackInput & { mode: EnqueueMode };

const liveTasks = new Map<string, DownloadTask>();
const albumBatches = new Map<string, AlbumBatch>();
const lastNotifyAt = new Map<string, number>();
const lastAlbumCompleteCount = new Map<string, { done: number; total: number }>();
// `.done()` can fire before the pump awaits this waiter; remember so restore does not hang.
const settleWaiters = new Map<string, { promise: Promise<void>; resolve: () => void }>();
const finishedBeforeWaiter = new Set<string>();
const pumpQueue: PumpItem[] = [];
const startedByPump = new Set<string>();
const slotWaiters: Array<() => void> = [];
const liveNotices = new Map<string, LiveNotice>();
// Restored paused jobs (force-stop recovery). resume() through the pump —
// createDownloadTask().start() would cleanupStaleState and delete the partial.
const reattachedPaused = new Map<string, DownloadTask>();
let iosSessionWarmed = false;
let drainRunning = false;
let iosDumpingToNative = false;
let languageHooked = false;
let appStateHooked = false;
let networkHooked = false;
let completeScanHooked = false;
let playbackKickHooked = false;
let initPromise: Promise<void> | null = null;
let suppressDownloadNotices = false;

// getExistingDownloadTasks / completeHandler can hang after a swipe-kill; fall back so restore still runs.
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

function parseMeta(task: DownloadTask): TaskMeta | null {
  let raw: unknown = task.metadata;
  // Android may persist metadata as a JSON string; parse so we can reattach after process death.
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = undefined;
    }
  }
  const meta = raw as Partial<TaskMeta> | undefined;
  const trackId =
    typeof meta?.trackId === "string" && meta.trackId.length > 0
      ? meta.trackId
      : task.id;
  const stored = filesForTrack(trackId)[0];
  const albumId =
    typeof meta?.albumId === "string" && meta.albumId.length > 0
      ? meta.albumId
      : stored?.albumId;
  const remoteUrl =
    typeof meta?.remoteUrl === "string" && meta.remoteUrl.length > 0
      ? meta.remoteUrl
      : stored?.remoteUrl;
  if (!albumId || !trackId || !remoteUrl) {
    return null;
  }
  const mode: EnqueueMode =
    meta?.mode === "single" || stored?.mode === "single" ? "single" : "batch";
  return { albumId, trackId, remoteUrl, mode };
}

function catalogueByteSize(albumId: string, trackId: string): number {
  const track = getTrackInCollection(
    useCatalogueStore.getState().catalogue,
    albumId,
    trackId,
  );
  return track && "byteSize" in track ? (track.byteSize ?? 0) : 0;
}

function expectedBytesFor(
  trackId: string,
  albumId: string,
  fallback?: number,
): number {
  if (fallback != null && fallback > 0) {
    return fallback;
  }
  const stored = filesForTrack(trackId).find((file) => file.albumId === albumId);
  if (stored?.bytes != null && stored.bytes > 0) {
    return stored.bytes;
  }
  return catalogueByteSize(albumId, trackId);
}

// Restored native jobs often stay PENDING/DOWNLOADING after the file is on disk,
// and `.done()` will not fire because the complete event already happened.
function fileLooksComplete(
  trackId: string,
  albumId: string,
  fallbackBytes?: number,
): boolean {
  const onDisk = downloadedBytesOnDisk(trackId);
  if (onDisk == null) {
    return false;
  }
  const expected = expectedBytesFor(trackId, albumId, fallbackBytes);
  if (expected > 0) {
    return onDisk >= expected;
  }
  // Without a known size, a partial file after a swipe looks complete. Only
  // native DONE / bytesTotal is trusted in that case.
  return false;
}

function nativeTaskFinished(task: DownloadTask): boolean {
  const state = String(task.state).toUpperCase();
  if (state === "DONE" || state === "COMPLETED") {
    return true;
  }
  return task.bytesTotal > 0 && task.bytesDownloaded >= task.bytesTotal;
}

/** `stop()` deletes the dest. iOS may report 0 downloaded while the partial is on disk. */
function iosTaskHasSavedProgress(task: DownloadTask, trackId: string): boolean {
  if (task.bytesDownloaded > 0) {
    return true;
  }
  const onDisk = downloadedBytesOnDisk(trackId);
  return onDisk != null && onDisk > 0;
}

function applyCellularPolicy(): void {
  const wifiOnly = usePreferencesStore.getState().wifiOnlyDownloads !== false;
  setConfig({
    allowsCellularAccess: !wifiOnly,
    progressInterval: PROGRESS_INTERVAL_MS,
    progressMinBytes: PROGRESS_MIN_BYTES,
    maxParallelDownloads: maxParallelDownloads(),
    ...(Platform.OS === "ios"
      ? // Locked-screen URLSession must still write the dest file.
      { iosDataProtection: "none" as const }
      : {}),
    // Android 14 UIDT still posts a silent mini notice. Do not enable library
    // grouping — that adds a second English summary next to notify-kit.
    showNotificationsEnabled: false,
    showCompletionNotification: false,
    notificationsGrouping: {
      enabled: false,
    },
  });
}

/** Settings Wi-Fi toggle must reach jobs already running, not only the next enqueue. */
export function syncDownloaderCellularPolicy(): void {
  applyCellularPolicy();
}

function confirm(title: string, body: string, ok: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, body, [
      {
        text: i18n.t("download.cancel"),
        style: "cancel",
        onPress: () => resolve(false),
      },
      { text: ok, onPress: () => resolve(true) },
    ]);
  });
}

async function allowNetwork(): Promise<boolean> {
  if (!isOnline()) {
    Alert.alert(i18n.t("download.offlineTitle"), i18n.t("download.offlineBody"));
    return false;
  }
  const wifiOnly = usePreferencesStore.getState().wifiOnlyDownloads !== false;
  if (isCellular() && wifiOnly) {
    Alert.alert(
      i18n.t("download.wifiOnlyTitle"),
      i18n.t("download.wifiOnlyBody"),
    );
    return false;
  }
  if (isCellular()) {
    return confirm(
      i18n.t("download.cellularTitle"),
      i18n.t("download.cellularBody"),
      i18n.t("download.cellularContinue"),
    );
  }
  return true;
}

function allowStorage(tracks: DownloadTrackInput[]): boolean {
  const needed = tracks.reduce((sum, track) => sum + track.byteSize, 0);
  const free = availableBytes();
  if (free < needed + STORAGE_MARGIN_BYTES) {
    Alert.alert(
      i18n.t("download.storageTitle"),
      i18n.t("download.storageBody"),
    );
    return false;
  }
  return true;
}

function catalogueTrackIds(): Set<string> {
  return catalogueAllTrackIds(useCatalogueStore.getState().catalogue);
}

function sessionTrackIds(): Set<string> {
  const session = usePlaybackStore.getState().session;
  return new Set(session?.tracks.map((track) => track.id) ?? []);
}

export function isTrackInQueue(trackId: string): boolean {
  return sessionTrackIds().has(trackId);
}

export function isCurrentlyPlayingTrack(trackId: string): boolean {
  const status = usePlaybackStore.getState();
  // Buffering is still this item — deleting the dest would stall native.
  return (
    (status.playing || status.buffering) && status.currentTrackId === trackId
  );
}

// Nitro keeps the current item plus `gaplessPreloadCount` (3) upcoming AVPlayer
// items. URLSession of those same CDN URLs often never ticks while they buffer.
function playbackHeldTrackIds(
  status = usePlaybackStore.getState(),
): Set<string> {
  const ids = new Set<string>();
  if (Platform.OS !== "ios") {
    return ids;
  }
  if ((!status.playing && !status.buffering) || !status.session) {
    return ids;
  }
  const index = status.currentIndex;
  if (index < 0) {
    return ids;
  }
  const last = Math.min(status.session.tracks.length, index + 1 + 3);
  for (let i = index; i < last; i += 1) {
    const id = status.session.tracks[i]?.id;
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

/** True when this track’s download is deferred for the iOS gapless window. */
export function isTrackDownloadHeldForPlayback(
  trackId: string,
  status = usePlaybackStore.getState(),
): boolean {
  return playbackHeldTrackIds(status).has(trackId);
}

function shouldDeferForPlayback(item: PumpItem): boolean {
  if (Platform.OS !== "ios" || !iosPlaybackBusy()) {
    return false;
  }
  // Never URLSession the gapless window (current + next 3) while AVPlayer holds it.
  return playbackHeldTrackIds().has(item.trackId);
}

export function playableUrlFor(
  trackId: string,
  remoteUrl: string,
): string | null {
  const file = getFile(trackId, remoteUrl);
  if (file?.status !== "completed") {
    return null;
  }
  return playableUri(trackId);
}

// Dynamic import so downloads → playback/engine → adapter → downloads stays off the static graph.
function notifyPlaybackQueueSourcesChanged(): void {
  // While playing, iOS skip/onTrackChange resolve file: from disk. Do not
  // queue the player mutex on every complete (that raced play() while buffering).
  if (Platform.OS === "ios") {
    const status = usePlaybackStore.getState();
    if (status.playing || status.buffering) {
      return;
    }
  }
  void import("@/playback/live-queue").then((mod) => {
    mod.notifyLiveQueueSourcesChanged();
  });
}

function addToAlbumBatch(
  albumId: string,
  trackId: string,
  title: string,
): boolean {
  const existing = albumBatches.get(albumId);
  if (existing) {
    if (!existing.pending.has(trackId)) {
      existing.pending.add(trackId);
      existing.total += 1;
    }
    if (title) {
      existing.title = title;
    }
    return true;
  }
  albumBatches.set(albumId, {
    pending: new Set([trackId]),
    total: 1,
    done: 0,
    title,
  });
  return false;
}

function removeFromAlbumBatch(
  albumId: string,
  trackId: string,
  outcome: "completed" | "failed" | "cancelled",
): void {
  const existing = albumBatches.get(albumId);
  if (!existing || !existing.pending.has(trackId)) {
    return;
  }
  existing.pending.delete(trackId);
  if (outcome === "completed") {
    existing.done += 1;
  } else if (outcome === "cancelled") {
    // Shrink total so a cancelled track does not leave the header stuck at 8/143.
    existing.total = Math.max(existing.done + existing.pending.size, existing.done);
  }
  if (existing.pending.size === 0) {
    albumBatches.delete(albumId);
  }
  syncBatchSnapshot(albumId);
}

function albumCompleteBody(albumId: string): string {
  const counts = lastAlbumCompleteCount.get(albumId);
  if (counts && counts.total > 0) {
    return i18n.t("download.notificationCompleteCount", counts);
  }
  return i18n.t("download.notificationComplete");
}

function rememberAlbumCompleteCount(
  albumId: string,
  trackId: string,
  outcome: "completed" | "failed" | "cancelled",
): void {
  const batch = albumBatches.get(albumId);
  // Snapshot before the last pending id is removed — the complete notice needs 142/143.
  if (!batch?.pending.has(trackId) || batch.pending.size !== 1) {
    return;
  }
  lastAlbumCompleteCount.set(albumId, {
    done: batch.done + (outcome === "completed" ? 1 : 0),
    total: batch.total,
  });
}

function albumBatchProgress(albumId: string): {
  done: number;
  total: number;
  percent: number;
  title: string;
} {
  const batch = albumBatches.get(albumId);
  if (!batch || batch.total === 0) {
    return { done: 0, total: 0, percent: 0, title: "" };
  }
  const progress = useDownloadStore.getState().progress;
  let weighted = batch.done;
  for (const trackId of batch.pending) {
    const record = fileForTrackOnAlbum(trackId, albumId);
    if (record?.status === "completed") {
      weighted += 1;
      continue;
    }
    const live = progress[trackId];
    if (live && live.bytesTotal > 0) {
      weighted += live.bytesDownloaded / live.bytesTotal;
    }
  }
  return {
    done: batch.done,
    total: batch.total,
    percent: (weighted / batch.total) * 100,
    title: batch.title,
  };
}

function syncBatchSnapshot(albumId: string): void {
  if (!albumBatches.has(albumId)) {
    // Engine map empty does not mean the album is idle — swipe restore used
    // to call setBatch(null) here and hide the header while rows stayed in-flight.
    useDownloadStore.getState().setBatch(albumId, batchSnapshotForAlbum(albumId));
    return;
  }
  const { percent, done, total } = albumBatchProgress(albumId);
  useDownloadStore.getState().setBatch(albumId, { percent, done, total });
}

function uiLocale(): string {
  return i18n.resolvedLanguage ?? i18n.language;
}

function localizedAlbumNoticeTitle(
  albumId: string,
  fallback?: string,
): string {
  const catalogue = useCatalogueStore.getState().catalogue;
  const collection = getCollectionById(catalogue, albumId);
  if (!collection) {
    return fallback || i18n.t("download.notificationAlbum");
  }
  const reciter = collection.reciterId
    ? getReciterById(catalogue, collection.reciterId)
    : undefined;
  const reciterName = reciter
    ? resolveL10n(reciter.name, uiLocale())
    : "";
  const kindLabel = i18n.t(`collection.${collection.kind}`);
  return reciterName ? `${reciterName} · ${kindLabel}` : kindLabel;
}

function localizedTrackNotice(
  trackId: string,
  albumId: string,
  fallbackTitle: string,
  fallbackReciter?: string,
): { title: string; reciterName: string | undefined } {
  const catalogue = useCatalogueStore.getState().catalogue;
  const track = getTrackInCollection(catalogue, albumId, trackId);
  const title = track
    ? resolveL10n(track.title, uiLocale())
    : fallbackTitle;
  const collection = getCollectionById(catalogue, albumId);
  const reciter = collection?.reciterId
    ? getReciterById(catalogue, collection.reciterId)
    : undefined;
  const reciterName = reciter
    ? resolveL10n(reciter.name, uiLocale())
    : fallbackReciter;
  return { title, reciterName };
}

function inputFromFile(file: { albumId: string; trackId: string; remoteUrl: string; bytes?: number }): DownloadTrackInput {
  const copy = localizedTrackNotice(file.trackId, file.albumId, file.trackId);
  return {
    albumId: file.albumId,
    trackId: file.trackId,
    remoteUrl: file.remoteUrl,
    byteSize: file.bytes ?? 0,
    title: copy.title,
    reciterName: copy.reciterName,
    albumTitle: localizedAlbumNoticeTitle(file.albumId),
  };
}

async function notifyAlbum(albumId: string, force = false): Promise<void> {
  const { percent, done, total, title } = albumBatchProgress(albumId);
  syncBatchSnapshot(albumId);
  if (total === 0) {
    return;
  }
  // Idle (no session / JS suspended) or playing: one "Downloading…" post — a
  // frozen done/total looks stuck. Percent resumes when paused with a session.
  if (Platform.OS === "ios" && !iosCanShowDownloadProgress()) {
    pendingAlbumNoticeId = albumId;
    if (iosIndeterminateAlbumIds.has(albumId) && !force) {
      return;
    }
    iosIndeterminateAlbumIds.add(albumId);
    const id = albumNotificationId(albumId);
    const displayTitle = localizedAlbumNoticeTitle(albumId, title);
    liveNotices.set(id, {
      kind: "album",
      albumId,
      title: displayTitle,
      percent: 0,
    });
    lastNotifyAt.set(id, Date.now());
    await showProgressNotification({
      id,
      title: displayTitle,
      body: i18n.t("download.notificationTrack"),
      percent: 0,
      albumId,
    });
    return;
  }
  iosIndeterminateAlbumIds.delete(albumId);
  const id = albumNotificationId(albumId);
  const now = Date.now();
  const last = lastNotifyAt.get(id) ?? 0;
  if (!force && now - last < NOTIFY_THROTTLE_MS && percent < 100) {
    return;
  }
  lastNotifyAt.set(id, now);
  const displayTitle = localizedAlbumNoticeTitle(albumId, title);
  liveNotices.set(id, {
    kind: "album",
    albumId,
    title: displayTitle,
    percent,
  });
  await showProgressNotification({
    id,
    title: displayTitle,
    body: i18n.t("download.notificationAlbumBody", { done, total }),
    percent,
    albumId,
  });
}

async function notifyTrack(
  trackId: string,
  title: string,
  reciterName: string | undefined,
  percent: number,
  albumId: string,
  force = false,
): Promise<void> {
  const id = trackNotificationId(trackId);
  let notificationTitle: string;
  if (Platform.OS === "ios") {
    notificationTitle = `${title} · ${reciterName}`;
  } else {
    notificationTitle = title;
  }

  if (Platform.OS === "ios" && !iosCanShowDownloadProgress() && percent < 100) {
    if (iosIndeterminateTrackIds.has(trackId) && !force) {
      return;
    }
    iosIndeterminateTrackIds.add(trackId);
    lastNotifyAt.set(id, Date.now());
    liveNotices.set(id, {
      kind: "track",
      albumId,
      trackId,
      title,
      reciterName,
      percent: 0,
    });
    await showProgressNotification({
      id,
      title: notificationTitle,
      body: i18n.t("download.notificationTrack"),
      percent: 0,
      albumId,
    });
    return;
  }
  if (Platform.OS === "ios") {
    iosIndeterminateTrackIds.delete(trackId);
  }
  const now = Date.now();
  const last = lastNotifyAt.get(id) ?? 0;
  if (!force && now - last < NOTIFY_THROTTLE_MS && percent < 100) {
    return;
  }
  lastNotifyAt.set(id, now);
  liveNotices.set(id, {
    kind: "track",
    albumId,
    trackId,
    title,
    reciterName,
    percent,
  });
  const notificationBody =
    Platform.OS === "ios"
      ? `${Math.max(0, Math.min(100, Math.round(percent)))}%`
      : reciterName || i18n.t("download.notificationTrack");
  await showProgressNotification({
    id,
    title: notificationTitle,
    body: notificationBody,
    percent,
    albumId,
  });
}

async function relocalizeProgressNotifications(): Promise<void> {
  await relocalizeDownloadChannel();
  applyCellularPolicy();
  for (const notice of liveNotices.values()) {
    if (notice.kind === "album") {
      const batch = albumBatches.get(notice.albumId);
      if (batch) {
        batch.title = localizedAlbumNoticeTitle(notice.albumId, batch.title);
      }
      lastNotifyAt.delete(albumNotificationId(notice.albumId));
      await notifyAlbum(notice.albumId, true);
      continue;
    }
    if (!notice.trackId) {
      continue;
    }
    const copy = localizedTrackNotice(
      notice.trackId,
      notice.albumId,
      notice.title,
      notice.reciterName,
    );
    lastNotifyAt.delete(trackNotificationId(notice.trackId));
    await notifyTrack(
      notice.trackId,
      copy.title,
      copy.reciterName,
      notice.percent,
      notice.albumId,
      true,
    );
  }
  // Complete notices are not in liveNotices; repost so the body picks up the new locale.
  const displayed = await displayedDownloadNotificationIds();
  for (const id of displayed) {
    if (liveNotices.has(id)) {
      continue;
    }
    const albumId = albumIdFromDownloadNotificationId(id);
    if (!albumId) {
      continue;
    }
    if (isAlbumNotificationId(id)) {
      await showCompleteNotification({
        id,
        title: localizedAlbumNoticeTitle(albumId),
        body: albumCompleteBody(albumId),
        albumId,
      });
      continue;
    }
    if (!isTrackNotificationId(id)) {
      continue;
    }
    const trackId = trackIdFromDownloadNotificationId(id);
    if (!trackId) {
      continue;
    }
    const copy = localizedTrackNotice(trackId, albumId, trackId);
    await showCompleteNotification({
      id,
      title: copy.title,
      body: i18n.t("download.notificationComplete"),
      albumId,
    });
  }
}

function ensureSettleWaiter(trackId: string): Promise<void> {
  if (finishedBeforeWaiter.has(trackId)) {
    finishedBeforeWaiter.delete(trackId);
    return Promise.resolve();
  }
  const existing = settleWaiters.get(trackId);
  if (existing) {
    return existing.promise;
  }
  let resolve = (): void => { };
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  settleWaiters.set(trackId, { promise, resolve });
  return promise;
}

function resolveSettleWaiter(trackId: string): void {
  startedByPump.delete(trackId);
  reattachedPaused.delete(trackId);
  const waiter = settleWaiters.get(trackId);
  if (waiter) {
    waiter.resolve();
    settleWaiters.delete(trackId);
  } else {
    finishedBeforeWaiter.add(trackId);
  }
  while (slotWaiters.length > 0 && startedByPump.size < maxParallelDownloads()) {
    slotWaiters.shift()?.();
  }
}

function waitForPumpSlot(): Promise<void> {
  if (startedByPump.size < maxParallelDownloads()) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    slotWaiters.push(resolve);
    // Job may have settled between the size check and the push.
    if (startedByPump.size < maxParallelDownloads()) {
      slotWaiters.shift()?.();
    }
  });
}

function iosBackgrounded(): boolean {
  return Platform.OS === "ios" && AppState.currentState === "background";
}

function armSlotWatchdog(item: PumpItem): void {
  const trackId = item.trackId;
  if (Platform.OS !== "ios") {
    setTimeout(() => {
      if (!startedByPump.has(trackId)) {
        return;
      }
      const live = liveTasks.get(trackId);
      if (live != null && live.bytesDownloaded > 0) {
        return;
      }
      // Native start/resume produced no bytes. Free the slot so the rest of
      // the album is not stuck behind a silent UIDT/FGS failure.
      resolveSettleWaiter(trackId);
    }, 20_000);
    return;
  }
  const liveAtArm = liveTasks.get(trackId);
  const bytesAtArm = liveAtArm?.bytesDownloaded ?? 0;
  setTimeout(() => {
    // JS timers can fire once while locking; do not stop a live URLSession job.
    if (AppState.currentState !== "active") {
      return;
    }
    if (!startedByPump.has(trackId)) {
      return;
    }
    const live = liveTasks.get(trackId);
    if (live != null && live.bytesDownloaded > bytesAtArm) {
      return;
    }
    // e28e17a Android only frees the slot (20s). iOS stop()+restart at 8s was
    // for AVPlayer-held CDN URLs that never tick — tearing those jobs down
    // while AVPlayer is live freezes Now Playing (~6–10s into the stream).
    if (iosPlaybackBusy() || playbackHeldTrackIds().has(trackId)) {
      return;
    }
    if (stillQueued(item)) {
      // Force-quit resume data can stall with no bytes. Retry only when the
      // player is not using the network.
      void retryStalledIosDownload(item);
      return;
    }
    resolveSettleWaiter(trackId);
  }, 8_000);
}

async function retryStalledIosDownload(item: PumpItem): Promise<void> {
  // Background URLSession often swallows the first task until it is warmed;
  // stop and re-queue so later jobs are not blocked by a zombie first id.
  await stopLiveTask(item.trackId);
  resolveSettleWaiter(item.trackId);
  if (stillQueued(item)) {
    enqueuePump(item);
  }
}

async function warmIosDownloader(): Promise<void> {
  if (Platform.OS !== "ios" || iosSessionWarmed) {
    return;
  }
  await withTimeout(getExistingDownloadTasks(), 3000, []);
  iosSessionWarmed = true;
}

// Cap new start() calls only. Reattached native jobs are not in startedByPump —
// occupying slots on them deadlocked the queue when `.done()` never fired after a kill.
async function drainPump(): Promise<void> {
  if (drainRunning || iosDumpingToNative) {
    return;
  }
  drainRunning = true;
  try {
    while (pumpQueue.length > 0) {
      if (iosDumpingToNative) {
        break;
      }
      // iOS: always 1-wide. 3-wide while AVPlayer is live froze the UI
      // (~31 small-file completes in ~6s on the same CDN as gapless items).
      if (startedByPump.size >= maxParallelDownloads()) {
        await waitForPumpSlot();
        continue;
      }
      // Restored iOS URLSession jobs hang when started offline; leave them queued.
      if (Platform.OS === "ios" && !isOnline()) {
        break;
      }
      const item = pumpQueue.shift();
      if (!item) {
        break;
      }
      if (iosDumpingToNative) {
        pumpQueue.unshift(item);
        break;
      }
      if (!stillQueued(item)) {
        reattachedPaused.delete(item.trackId);
        continue;
      }
      if (Platform.OS === "ios" && shouldDeferForPlayback(item)) {
        pumpQueue.push(item);
        if (pumpQueue.some((queued) => !playbackHeldTrackIds().has(queued.trackId))) {
          continue;
        }
        if (startedByPump.size > 0) {
          await waitForPumpSlot();
          continue;
        }
        break;
      }
      const paused = reattachedPaused.get(item.trackId);
      if (paused) {
        reattachedPaused.delete(item.trackId);
        finishedBeforeWaiter.delete(item.trackId);
        ensureSettleWaiter(item.trackId);
        startedByPump.add(item.trackId);
        bindTask(
          paused,
          {
            albumId: item.albumId,
            trackId: item.trackId,
            remoteUrl: item.remoteUrl,
            mode: item.mode,
          },
          item.title,
          item.reciterName,
        );
        void paused.resume().catch(() => {
          resolveSettleWaiter(item.trackId);
        });
        armSlotWatchdog(item);
        continue;
      }
      if (liveTasks.has(item.trackId)) {
        // Android: leave the UIDT handle attached. stop() deletes the dest.
        if (Platform.OS !== "ios" || startedByPump.has(item.trackId)) {
          continue;
        }
        await stopLiveTask(item.trackId);
      }
      finishedBeforeWaiter.delete(item.trackId);
      ensureSettleWaiter(item.trackId);
      startedByPump.add(item.trackId);
      try {
        if (Platform.OS === "ios") {
          await warmIosDownloader();
        }
        startNativeTask(item);
        armSlotWatchdog(item);
      } catch {
        resolveSettleWaiter(item.trackId);
      }
    }
  } finally {
    drainRunning = false;
    if (Platform.OS !== "ios") {
      if (pumpQueue.length > 0) {
        void drainPump();
      }
      return;
    }
    // Do not spin while offline or while only AVPlayer-held tracks remain and
    // nothing is pumping — pause / track change / the 5s scan re-enters drainPump.
    const onlyHeldLeft =
      startedByPump.size === 0 &&
      pumpQueue.length > 0 &&
      pumpQueue.every((queued) => shouldDeferForPlayback(queued));
    if (pumpQueue.length > 0 && isOnline() && !onlyHeldLeft) {
      void drainPump();
    }
  }
}

function enqueuePump(item: PumpItem): void {
  pumpQueue.push(item);
  void drainPump();
}

function handOffPumpItemToNative(item: PumpItem, occupyPumpSlot = true): void {
  const paused = reattachedPaused.get(item.trackId);
  if (paused) {
    reattachedPaused.delete(item.trackId);
    finishedBeforeWaiter.delete(item.trackId);
    if (occupyPumpSlot) {
      ensureSettleWaiter(item.trackId);
      startedByPump.add(item.trackId);
    }
    bindTask(
      paused,
      {
        albumId: item.albumId,
        trackId: item.trackId,
        remoteUrl: item.remoteUrl,
        mode: item.mode,
      },
      item.title,
      item.reciterName,
    );
    void paused.resume().catch(() => {
      resolveSettleWaiter(item.trackId);
    });
    return;
  }
  finishedBeforeWaiter.delete(item.trackId);
  if (occupyPumpSlot) {
    ensureSettleWaiter(item.trackId);
    startedByPump.add(item.trackId);
  }
  try {
    startNativeTask(item);
  } catch {
    resolveSettleWaiter(item.trackId);
  }
}

/**
 * Hand leftover JS queue to URLSession before lock freezes JS.
 * Only `background` — Control Center wifi (`inactive`) after a kill used to
 * dump the whole album and native-crashed. While playing, skip the gapless
 * window. Do not occupy JS pump slots so pause can still start held rows.
 */
async function startRemainingIosDownloadsNow(): Promise<void> {
  if (Platform.OS !== "ios" || !isOnline() || !iosBackgrounded()) {
    return;
  }
  const held = iosPlaybackBusy() ? playbackHeldTrackIds() : new Set<string>();
  const deferred: PumpItem[] = [];
  suppressDownloadNotices = true;
  try {
    while (pumpQueue.length > 0 && iosBackgrounded() && isOnline()) {
      const item = pumpQueue.shift();
      if (!item) {
        break;
      }
      if (!stillQueued(item)) {
        reattachedPaused.delete(item.trackId);
        continue;
      }
      if (held.has(item.trackId)) {
        deferred.push(item);
        continue;
      }
      if (liveTasks.has(item.trackId)) {
        continue;
      }
      handOffPumpItemToNative(item, false);
    }
  } finally {
    suppressDownloadNotices = false;
    pumpQueue.push(...deferred);
  }
  if (!iosPlaybackBusy() || hasUnheldLeftover()) {
    for (const albumId of albumBatches.keys()) {
      void notifyAlbum(albumId);
    }
  }
}

function bindTask(
  task: DownloadTask,
  meta: TaskMeta,
  title: string,
  reciterName?: string,
): void {
  liveTasks.set(task.id, task);
  task
    .begin(({ expectedBytes }) => {
      const key = makeKey(meta.trackId, meta.remoteUrl);
      const existing = useDownloadStore.getState().files[key];
      // Scan may have marked complete while UIDT is still finishing; do not
      // flip the row back to downloading.
      if (existing?.status === "completed" || existing?.status === "orphan") {
        return;
      }
      useDownloadStore.getState().patchFile(key, {
        status: "downloading",
        bytes: expectedBytes > 0 ? expectedBytes : undefined,
      });
    })
    .progress(({ bytesDownloaded, bytesTotal }) => {
      useDownloadStore.getState().setProgress(meta.trackId, {
        bytesDownloaded,
        bytesTotal,
      });
      if (meta.mode === "batch") {
        syncBatchSnapshot(meta.albumId);
        void notifyAlbum(meta.albumId);
        return;
      }
      const percent =
        bytesTotal > 0 ? (bytesDownloaded / bytesTotal) * 100 : 0;
      void notifyTrack(meta.trackId, title, reciterName, percent, meta.albumId);
    })
    .done(({ bytesDownloaded }) => {
      // Cancel leaves this id in the map until a new task replaces it; ignore stale ends.
      if (liveTasks.get(task.id) !== task) {
        return;
      }
      void finishTask(task.id, meta, title, "completed", bytesDownloaded);
    })
    .error(({ errorCode }) => {
      if (liveTasks.get(task.id) !== task) {
        return;
      }
      // Swipe-kill / stop() cancel is -999. A same-id replacement must not
      // be marked failed if that event arrives after start().
      if (Platform.OS === "ios" && errorCode === -999) {
        return;
      }
      void finishTask(task.id, meta, title, "failed");
    });
}

async function finishTask(
  jobId: string,
  meta: TaskMeta,
  title: string,
  outcome: "completed" | "failed",
  bytes?: number,
): Promise<void> {
  const live = liveTasks.get(jobId);
  const key = makeKey(meta.trackId, meta.remoteUrl);
  const previous = useDownloadStore.getState().files[key];
  const alreadySettled =
    previous?.status === "completed" ||
    previous?.status === "orphan" ||
    previous?.status === "failed";
  const canStopNative =
    live != null &&
    !nativeTaskPaused(live) &&
    (nativeTaskFinished(live) || outcome === "failed");
  // Keep the live handle until native is actually done so a later `.done()`
  // can stop() without a second start() of the same dest.
  if (!live || canStopNative || outcome === "failed") {
    liveTasks.delete(jobId);
  }
  const catalogueIds = catalogueTrackIds();
  const inSession = sessionTrackIds().has(meta.trackId);
  const orphan =
    outcome === "completed" && !catalogueIds.has(meta.trackId) && !inSession;
  if (!alreadySettled) {
    useDownloadStore.getState().patchFile(key, {
      status: orphan ? "orphan" : outcome,
      bytes,
    });
    useDownloadStore.getState().setProgress(meta.trackId, null);
  }
  resolveSettleWaiter(meta.trackId);
  if (outcome === "completed" && !alreadySettled) {
    notifyPlaybackQueueSourcesChanged();
  }
  if (canStopNative && live) {
    try {
      await withTimeout(Promise.resolve(completeHandler(jobId)), 3000, undefined);
    } catch {
      // iOS completeHandler is a no-op when the app was foreground the whole time.
    }
    void releaseNativeTask(live);
  }
  if (inFlightDownloadFiles().length === 0) {
    void sweepIdleNativeJobs();
  }
  if (alreadySettled) {
    return;
  }
  if (suppressDownloadNotices) {
    if (meta.mode === "batch") {
      rememberAlbumCompleteCount(meta.albumId, meta.trackId, outcome);
      removeFromAlbumBatch(meta.albumId, meta.trackId, outcome);
    } else {
      liveNotices.delete(trackNotificationId(meta.trackId));
      iosIndeterminateTrackIds.delete(meta.trackId);
      lastNotifyAt.delete(trackNotificationId(meta.trackId));
    }
    return;
  }
  if (meta.mode === "batch") {
    const batchTitle =
      albumBatches.get(meta.albumId)?.title ||
      i18n.t("download.notificationAlbum");
    rememberAlbumCompleteCount(meta.albumId, meta.trackId, outcome);
    removeFromAlbumBatch(meta.albumId, meta.trackId, outcome);
    if (albumBatches.has(meta.albumId)) {
      await notifyAlbum(meta.albumId);
    } else {
      liveNotices.delete(albumNotificationId(meta.albumId));
      iosIndeterminateAlbumIds.delete(meta.albumId);
      await showCompleteNotification({
        id: albumNotificationId(meta.albumId),
        title: batchTitle,
        body: albumCompleteBody(meta.albumId),
        albumId: meta.albumId,
      });
      lastNotifyAt.delete(albumNotificationId(meta.albumId));
    }
    return;
  }
  if (outcome === "completed") {
    liveNotices.delete(trackNotificationId(meta.trackId));
    iosIndeterminateTrackIds.delete(meta.trackId);
    await showCompleteNotification({
      id: trackNotificationId(meta.trackId),
      title,
      body: i18n.t("download.notificationComplete"),
      albumId: meta.albumId,
    });
  } else {
    liveNotices.delete(trackNotificationId(meta.trackId));
    iosIndeterminateTrackIds.delete(meta.trackId);
    await cancelDownloadNotification(trackNotificationId(meta.trackId));
  }
  lastNotifyAt.delete(trackNotificationId(meta.trackId));
}

function stillQueued(input: DownloadTrackInput): boolean {
  const file = getFile(input.trackId, input.remoteUrl);
  return file?.status === "queued" || file?.status === "downloading";
}

function startNativeTask(input: PumpItem): void {
  const dest = destinationPath(input.trackId);
  const wifiOnly = usePreferencesStore.getState().wifiOnlyDownloads !== false;
  const task = createDownloadTask({
    id: input.trackId,
    url: input.remoteUrl,
    destination: dest,
    metadata: {
      albumId: input.albumId,
      trackId: input.trackId,
      remoteUrl: input.remoteUrl,
      mode: input.mode,
    } satisfies TaskMeta,
    // UIDT reads this per-task flag; setConfig.allowsCellularAccess alone is not enough.
    isAllowedOverMetered: !wifiOnly,
    ...(Platform.OS === "ios"
      ? // Locked-screen URLSession must still write the dest file.
      { iosDataProtection: "none" as const }
      : {}),
  });
  bindTask(
    task,
    { ...input, mode: input.mode },
    input.title,
    input.reciterName,
  );
  task.start();
}

async function stopLiveTask(trackId: string): Promise<boolean> {
  const live = liveTasks.get(trackId) ?? reattachedPaused.get(trackId);
  reattachedPaused.delete(trackId);
  if (!live) {
    resolveSettleWaiter(trackId);
    return false;
  }
  liveTasks.delete(trackId);
  try {
    await live.stop();
  } catch {
    // Task may already have finished.
  }
  try {
    await completeHandler(live.id);
  } catch {
    // Needed so Android will accept the same track id on a later download.
  }
  resolveSettleWaiter(trackId);
  return true;
}

async function refreshAlbumNotification(albumId: string): Promise<void> {
  if (albumBatches.has(albumId)) {
    await notifyAlbum(albumId);
    return;
  }
  await cancelDownloadNotification(albumNotificationId(albumId));
  lastNotifyAt.delete(albumNotificationId(albumId));
}

function markQueued(tracks: DownloadTrackInput[], mode: EnqueueMode): void {
  const now = Date.now();
  useDownloadStore.getState().upsertFiles(
    tracks.map((input) => ({
      trackId: input.trackId,
      albumId: input.albumId,
      remoteUrl: input.remoteUrl,
      localPath: destinationPath(input.trackId),
      status: "queued" as const,
      updatedAt: now,
      mode,
    })),
  );
}

/** Gates network/storage, then pumps at most 3 native starts. Queued rows wait here so reattached UIDT jobs do not occupy slots. */
export async function enqueueDownloads(
  tracks: DownloadTrackInput[],
  mode: EnqueueMode,
): Promise<"started" | "added" | "noop" | "blocked"> {
  return mutex.runExclusive(async () => {
    const pending = tracks.filter(
      (track) =>
        !isTrackDownloaded(track.trackId, track.remoteUrl) &&
        !isTrackDownloading(track.trackId),
    );
    if (pending.length === 0) {
      return "noop";
    }
    // EAS --local does not load `.env`. A relative `/audio/…` URL crashes native.
    if (pending.some((track) => !/^https?:\/\//i.test(track.remoteUrl))) {
      Alert.alert(i18n.t("download.badUrlTitle"), i18n.t("download.badUrlBody"));
      return "blocked";
    }
    if (!(await allowNetwork())) {
      return "blocked";
    }
    if (!allowStorage(pending)) {
      return "blocked";
    }
    markQueued(pending, mode);
    ensureAudioDirectory();
    applyCellularPolicy();
    const albumId = pending[0]?.albumId;
    const alreadyBatch =
      mode === "batch" && albumId != null && albumBatches.has(albumId);
    if (mode === "batch" && albumId) {
      const title = localizedAlbumNoticeTitle(
        albumId,
        pending[0]?.albumTitle,
      );
      for (const track of pending) {
        addToAlbumBatch(albumId, track.trackId, title);
      }
      syncBatchSnapshot(albumId);
    }
    // Pump slots match maxParallelDownloads; queued tracks wait here.
    for (const track of pending) {
      enqueuePump({ ...track, mode });
    }
    if (mode === "batch" && albumId) {
      void notifyAlbum(albumId);
      useDownloadStore.getState().showSnackbar(
        Platform.OS === "ios" && iosPlaybackBusy() && !hasUnheldLeftover()
          ? { kind: "pausedForPlayback", count: pending.length }
          : alreadyBatch
            ? { kind: "addedTracks", count: pending.length }
            : { kind: "startedTracks", count: pending.length },
      );
      return alreadyBatch ? "added" : "started";
    }
    for (const track of pending) {
      // Post at 0% now: the native progress callback only runs after a pump slot frees.
      void notifyTrack(
        track.trackId,
        track.title,
        track.reciterName,
        0,
        track.albumId,
        true,
      );
    }
    useDownloadStore.getState().showSnackbar(
      Platform.OS === "ios" && iosPlaybackBusy() && !hasUnheldLeftover()
        ? { kind: "pausedForPlayback", count: 1 }
        : { kind: "startedTrack", count: 1 },
    );
    return "started";
  });
}

export async function removeDownloadedTracks(
  tracks: DownloadTrackInput[],
): Promise<void> {
  await mutex.runExclusive(async () => {
    for (const track of tracks) {
      if (isCurrentlyPlayingTrack(track.trackId)) {
        continue;
      }
      const live = await stopLiveTask(track.trackId);
      deleteLocalFile(track.trackId);
      useDownloadStore
        .getState()
        .removeFile(makeKey(track.trackId, track.remoteUrl));
      useDownloadStore.getState().setProgress(track.trackId, null);
      removeFromAlbumBatch(track.albumId, track.trackId, "cancelled");
      await cancelDownloadNotification(trackNotificationId(track.trackId));
      if (live) {
        await refreshAlbumNotification(track.albumId);
      }
    }
    notifyPlaybackQueueSourcesChanged();
  });
}

/** stop() + delete dest so Android will accept the same track id later. Store rows go away so OTA `hasInFlight` is false. */
export async function cancelDownloads(
  tracks: DownloadTrackInput[],
): Promise<void> {
  await mutex.runExclusive(async () => {
    const albums = new Set<string>();
    for (const track of tracks) {
      if (!isTrackDownloading(track.trackId)) {
        continue;
      }
      await stopLiveTask(track.trackId);
      deleteLocalFile(track.trackId);
      useDownloadStore
        .getState()
        .removeFile(makeKey(track.trackId, track.remoteUrl));
      useDownloadStore.getState().setProgress(track.trackId, null);
      if (albumBatches.get(track.albumId)?.pending.has(track.trackId)) {
        albums.add(track.albumId);
      }
      removeFromAlbumBatch(track.albumId, track.trackId, "cancelled");
      liveNotices.delete(trackNotificationId(track.trackId));
      iosIndeterminateTrackIds.delete(track.trackId);
      if (!albumBatches.has(track.albumId)) {
        liveNotices.delete(albumNotificationId(track.albumId));
        iosIndeterminateAlbumIds.delete(track.albumId);
      }
      await cancelDownloadNotification(trackNotificationId(track.trackId));
    }
    for (const albumId of albums) {
      await refreshAlbumNotification(albumId);
    }
  });
}

/** Persisted queued/downloading, not `liveTasks` — OTA apply needs this after process death too. */
export function hasInFlightDownloads(): boolean {
  return Object.values(useDownloadStore.getState().files).some(
    (file) => file.status === "queued" || file.status === "downloading",
  );
}

/** OTA reload tears down JS; native jobs must stop first or they keep the FGS on the new runtime. */
export async function cancelAllInFlightDownloads(): Promise<void> {
  const files = Object.values(useDownloadStore.getState().files).filter(
    (file) => file.status === "queued" || file.status === "downloading",
  );
  await cancelDownloads(
    files.map((file) => ({
      albumId: file.albumId,
      trackId: file.trackId,
      remoteUrl: file.remoteUrl,
      byteSize: file.bytes ?? 0,
      title: file.trackId,
    })),
  );
}

export function pruneOrphans(): void {
  const catalogueIds = catalogueTrackIds();
  const queued = sessionTrackIds();
  const playingId = usePlaybackStore.getState().currentTrackId;
  const { files, patchFile, removeFile } = useDownloadStore.getState();
  for (const [key, file] of Object.entries(files)) {
    const inCatalogue = catalogueIds.has(file.trackId);
    const inSession = queued.has(file.trackId);
    if (!inCatalogue && !inSession && file.status === "completed") {
      patchFile(key, { status: "orphan" });
    }
    const latest = useDownloadStore.getState().files[key];
    if (!latest || latest.status !== "orphan") {
      continue;
    }
    // Keep the dest while it is playing or still in the frozen session queue.
    if (playingId === latest.trackId || inSession) {
      continue;
    }
    deleteLocalFile(latest.trackId);
    removeFile(key);
  }
}

function waitForDownloadHydration(): Promise<void> {
  if (useDownloadStore.persist.hasHydrated()) {
    return Promise.resolve();
  }
  return withTimeout(
    new Promise<void>((resolve) => {
      const unsub = useDownloadStore.persist.onFinishHydration(() => {
        unsub();
        resolve();
      });
      // Hydration can finish between the hasHydrated check and the subscribe.
      if (useDownloadStore.persist.hasHydrated()) {
        unsub();
        resolve();
      }
    }),
    4000,
    undefined,
  ).then(() => undefined);
}

function fileEnqueueMode(
  file: { albumId: string; mode?: EnqueueMode },
  albumNoticeIds: Set<string>,
): EnqueueMode {
  // Persisted mode wins so a single on a batching album is not swallowed into that batch.
  if (file.mode === "single") {
    return "single";
  }
  if (file.mode === "batch" || albumBatches.has(file.albumId)) {
    return "batch";
  }
  if (albumNoticeIds.has(albumNotificationId(file.albumId))) {
    return "batch";
  }
  let siblings = 0;
  for (const other of Object.values(useDownloadStore.getState().files)) {
    if (other.albumId !== file.albumId) {
      continue;
    }
    if (other.status !== "queued" && other.status !== "downloading") {
      continue;
    }
    if (other.mode === "single") {
      continue;
    }
    siblings += 1;
  }
  if (siblings > 1) {
    return "batch";
  }
  return "single";
}

function nativeTaskPaused(task: DownloadTask): boolean {
  return String(task.state).toUpperCase() === "PAUSED";
}

function nativeTaskStillRunning(task: DownloadTask): boolean {
  const state = String(task.state).toUpperCase();
  return (
    state === "DOWNLOADING" || state === "PENDING" || state === "RUNNING"
  );
}

function metaForTask(task: DownloadTask): TaskMeta | null {
  const stored = filesForTrack(task.id)[0];
  return (
    parseMeta(task) ??
    (stored
      ? {
        albumId: stored.albumId,
        trackId: stored.trackId,
        remoteUrl: stored.remoteUrl,
        mode: stored.mode === "single" ? "single" : "batch",
      }
      : null)
  );
}

function rebuildAlbumBatches(
  tasks: { meta: TaskMeta }[],
  albumNoticeIds: Set<string>,
): void {
  albumBatches.clear();
  for (const { meta } of tasks) {
    if (meta.mode !== "batch") {
      continue;
    }
    addToAlbumBatch(
      meta.albumId,
      meta.trackId,
      localizedAlbumNoticeTitle(meta.albumId),
    );
  }
  const { files } = useDownloadStore.getState();
  const completedByAlbum = new Map<string, number>();
  for (const file of Object.values(files)) {
    if (file.status === "completed") {
      completedByAlbum.set(
        file.albumId,
        (completedByAlbum.get(file.albumId) ?? 0) + 1,
      );
    }
    if (file.status !== "queued" && file.status !== "downloading") {
      continue;
    }
    const mode = fileEnqueueMode(file, albumNoticeIds);
    if (!file.mode) {
      useDownloadStore.getState().patchFile(makeKey(file.trackId, file.remoteUrl), {
        mode,
      });
    }
    if (mode !== "batch") {
      continue;
    }
    addToAlbumBatch(
      file.albumId,
      file.trackId,
      localizedAlbumNoticeTitle(file.albumId),
    );
  }
  for (const [albumId, batch] of albumBatches) {
    const done = completedByAlbum.get(albumId) ?? 0;
    batch.done = done;
    batch.total = done + batch.pending.size;
    syncBatchSnapshot(albumId);
  }
  // Drop store snapshots for albums that are no longer a batch.
  const { batches } = useDownloadStore.getState();
  for (const albumId of Object.keys(batches)) {
    if (!albumBatches.has(albumId)) {
      useDownloadStore.getState().setBatch(albumId, batchSnapshotForAlbum(albumId));
    }
  }
  if (albumBatches.size === 0) {
    refreshBatchesFromFiles();
  }
}

async function releaseNativeTask(task: DownloadTask): Promise<void> {
  try {
    await withTimeout(task.stop(), 3000, undefined);
  } catch {
    // Already gone, or never started in this process.
  }
  try {
    await withTimeout(Promise.resolve(completeHandler(task.id)), 3000, undefined);
  } catch {
    // Android completeHandler is a no-op; iOS needs it to free the session id.
  }
}

async function sweepIdleNativeJobs(): Promise<void> {
  if (inFlightDownloadFiles().length > 0) {
    return;
  }
  const existing = await withTimeout(getExistingDownloadTasks(), 3000, []);
  for (const task of existing) {
    if (nativeTaskPaused(task) || nativeTaskStillRunning(task) || liveTasks.has(task.id)) {
      continue;
    }
    await releaseNativeTask(task);
  }
  try {
    await dismissLibraryDownloadNotifications();
  } catch {
    // Channel cancel is best-effort; UIDT notices need jobFinished above.
  }
}

function inFlightDownloadFiles(): DownloadFile[] {
  return Object.values(useDownloadStore.getState().files).filter(
    (file) => file.status === "queued" || file.status === "downloading",
  );
}

function downloadsNeedKick(): boolean {
  if (inFlightDownloadFiles().length === 0) {
    return false;
  }
  if (pumpQueue.length > 0 || startedByPump.size > 0) {
    return false;
  }
  if (Platform.OS === "ios") {
    return true;
  }
  for (const file of inFlightDownloadFiles()) {
    if (liveTasks.has(file.trackId) || reattachedPaused.has(file.trackId)) {
      continue;
    }
    return true;
  }
  return false;
}

/** Drop JS handles that occupy liveTasks after the pump gave up, so leftover can start(). */
async function releaseAbandonedLiveTasks(): Promise<void> {
  if (Platform.OS !== "ios") {
    return;
  }
  if (pumpQueue.length > 0 || startedByPump.size > 0) {
    return;
  }
  for (const file of inFlightDownloadFiles()) {
    if (!liveTasks.has(file.trackId) && !reattachedPaused.has(file.trackId)) {
      continue;
    }
    await stopLiveTask(file.trackId);
  }
}

async function scanInFlightCompletions(
  completedNotices?: Map<string, { title: string; albumId: string }>,
): Promise<void> {
  const notices = completedNotices ?? new Map();
  for (const file of inFlightDownloadFiles()) {
    const live = liveTasks.get(file.trackId);
    if (
      !fileLooksComplete(file.trackId, file.albumId, file.bytes) &&
      !(live != null && nativeTaskFinished(live))
    ) {
      continue;
    }
    const mode = fileEnqueueMode(file, new Set());
    const copy = localizedTrackNotice(file.trackId, file.albumId, file.trackId);
    await finishTask(
      file.trackId,
      {
        albumId: file.albumId,
        trackId: file.trackId,
        remoteUrl: file.remoteUrl,
        mode,
      },
      copy.title,
      "completed",
      file.bytes,
    );
    notices.set(
      mode === "batch"
        ? albumNotificationId(file.albumId)
        : trackNotificationId(file.trackId),
      {
        title:
          mode === "batch"
            ? localizedAlbumNoticeTitle(file.albumId)
            : copy.title,
        albumId: file.albumId,
      },
    );
  }
}

function enqueueLeftoverInFlight(drain = true): void {
  for (const file of inFlightDownloadFiles()) {
    if (liveTasks.has(file.trackId)) {
      continue;
    }
    if (pumpQueue.some((item) => item.trackId === file.trackId)) {
      continue;
    }
    if (startedByPump.has(file.trackId)) {
      continue;
    }
    const mode = fileEnqueueMode(file, new Set());
    const item = { ...inputFromFile(file), mode };
    if (drain) {
      enqueuePump(item);
    } else {
      pumpQueue.push(item);
    }
  }
  if (Platform.OS === "ios" && drain) {
    // Skipped rows may already sit in pumpQueue from an offline drain abort.
    void drainPump();
  }
}

async function stopAndRequeueLive(trackId: string): Promise<void> {
  const file = filesForTrack(trackId)[0];
  await stopLiveTask(trackId);
  if (file && (file.status === "queued" || file.status === "downloading")) {
    useDownloadStore.getState().patchFile(makeKey(file.trackId, file.remoteUrl), {
      status: "queued",
    });
  }
}

/** Drop URLSession jobs that just entered the gapless window. */
async function trimIosDownloadsForPlayback(): Promise<void> {
  const held = playbackHeldTrackIds();
  for (const trackId of [...liveTasks.keys()]) {
    if (held.has(trackId)) {
      await stopAndRequeueLive(trackId);
    }
  }
  enqueueLeftoverInFlight();
  notifyDownloadsPausedForPlayback();
  if (hasUnheldLeftover()) {
    for (const albumId of albumBatches.keys()) {
      void notifyAlbum(albumId);
    }
  }
}

async function kickIosDownloadsAfterPlayback(): Promise<void> {
  while (slotWaiters.length > 0 && startedByPump.size < maxParallelDownloads()) {
    slotWaiters.shift()?.();
  }
  enqueueLeftoverInFlight();
}

/** Stop 0-byte iOS jobs when NetInfo goes offline. Partials stay; `stop()` would delete them. */
async function parkLiveIosDownloads(): Promise<void> {
  const trackIds = [...liveTasks.keys()];
  const albumIds = new Set<string>();
  for (const trackId of trackIds) {
    const live = liveTasks.get(trackId);
    // stop() deletes the dest; keep a partial URLSession job until native fails.
    if (live && iosTaskHasSavedProgress(live, trackId)) {
      continue;
    }
    const file = filesForTrack(trackId)[0];
    await stopLiveTask(trackId);
    if (
      file &&
      file.status !== "completed" &&
      file.status !== "failed" &&
      file.status !== "orphan"
    ) {
      useDownloadStore.getState().patchFile(makeKey(file.trackId, file.remoteUrl), {
        status: "queued",
      });
      albumIds.add(file.albumId);
    }
  }
  enqueueLeftoverInFlight();
  for (const albumId of albumIds) {
    await notifyAlbum(albumId, true);
  }
}

async function resumeStalledDownloads(): Promise<void> {
  if (albumBatches.size === 0 && inFlightDownloadFiles().length > 0) {
    rebuildAlbumBatches([], new Set());
  }
  const completedNotices = new Map<string, { title: string; albumId: string }>();
  await scanInFlightCompletions(completedNotices);
  await releaseAbandonedLiveTasks();
  if (downloadsNeedKick()) {
    enqueueLeftoverInFlight();
  } else if (inFlightDownloadFiles().length === 0) {
    void sweepIdleNativeJobs();
  }
  try {
    await withTimeout(reconcileDownloadNotifications(completedNotices), 4000, undefined);
  } catch {
    // Shade is best-effort; the pump already has the leftover tracks.
  }
}

function hookDownloadResumeOnActive(): void {
  if (!appStateHooked) {
    appStateHooked = true;
    AppState.addEventListener("change", (state) => {
      if (state === "active") {
        if (Platform.OS === "ios" && iosPlaybackBusy()) {
          enqueueLeftoverInFlight();
          return;
        }
        void resumeStalledDownloads();
        return;
      }
      if (Platform.OS === "ios" && state === "background") {
        // Lock only. Control Center / wifi-on is `inactive` — drainPump
        // (1-wide) is the restore path, not a dump.
        void mutex.runExclusive(async () => {
          iosDumpingToNative = true;
          try {
            await warmIosDownloader();
            enqueueLeftoverInFlight(false);
            await startRemainingIosDownloadsNow();
          } finally {
            iosDumpingToNative = false;
          }
          if (pumpQueue.length > 0) {
            void drainPump();
          }
        });
        // Idle / playing: JS will suspend — leave "Downloading…" not a frozen count.
        if (!iosCanShowDownloadProgress() && liveNotices.size > 0) {
          refreshLiveDownloadNotices();
        }
      }
    });
  }
  if (!networkHooked) {
    networkHooked = true;
    if (Platform.OS === "ios") {
      subscribeNetwork((online) => {
        void mutex.runExclusive(async () => {
          if (!online) {
            await parkLiveIosDownloads();
          } else {
            // Restore / wifi-on: JS pump only. Dumping here from Control Center
            // after a kill native-crashed (~140 start()s of zombie sessions).
            enqueueLeftoverInFlight();
          }
        });
      });
    }
  }
  if (!playbackKickHooked) {
    playbackKickHooked = true;
    if (Platform.OS === "ios") {
      usePlaybackStore.subscribe((state, prev) => {
        const wasBusy = prev.playing || prev.buffering;
        const isBusy = state.playing || state.buffering;
        const wasCanShow = iosProgressGateFromStatus(prev);
        const canShow = iosProgressGateFromStatus(state);
        if (!wasBusy && isBusy) {
          void mutex.runExclusive(async () => {
            await trimIosDownloadsForPlayback();
          });
        }
        if (wasBusy && !isBusy) {
          flushDeferredDownloadsPersist();
          void mutex.runExclusive(async () => {
            await kickIosDownloadsAfterPlayback();
          });
        }
        // Shade body: percent / done-total only when paused with a live session.
        if (wasCanShow !== canShow && liveNotices.size > 0) {
          refreshLiveDownloadNotices();
        } else if (!wasCanShow && canShow && pendingAlbumNoticeId) {
          const albumId = pendingAlbumNoticeId;
          pendingAlbumNoticeId = null;
          void notifyAlbum(albumId, true);
        }
        if (state.currentTrackId === prev.currentTrackId) {
          return;
        }
        if (inFlightDownloadFiles().length === 0) {
          return;
        }
        if (isBusy) {
          // Gapless window moved; drop jobs that are now current/next 3.
          void mutex.runExclusive(async () => {
            await trimIosDownloadsForPlayback();
          });
          return;
        }
        // AVPlayer released the previous item; start the leftover playback-window jobs.
        void resumeStalledDownloads();
      });
    }
  }
  if (completeScanHooked) {
    return;
  }
  completeScanHooked = true;
  // Restored UIDT jobs often never fire `.done()`. Finish from disk while bytes match.
  setInterval(() => {
    flushDeferredDownloadsPersist();
    if (AppState.currentState !== "active") {
      return;
    }
    if (inFlightDownloadFiles().length === 0) {
      return;
    }
    void scanInFlightCompletions();
    if (Platform.OS === "ios") {
      if (iosPlaybackBusy()) {
        if (startedByPump.size === 0 && hasUnheldLeftover()) {
          enqueueLeftoverInFlight();
        }
        return;
      }
      void (async () => {
        await releaseAbandonedLiveTasks();
        if (downloadsNeedKick()) {
          enqueueLeftoverInFlight();
        }
      })();
    }
  }, 5000);
}

async function attachExistingTasks(
  completedNotices: Map<string, { title: string; albumId: string }>,
): Promise<void> {
  const existing = await withTimeout(getExistingDownloadTasks(), 5000, []);
  const unknown: DownloadTask[] = [];
  for (const task of existing) {
    const meta = metaForTask(task);
    if (!meta) {
      unknown.push(task);
      continue;
    }
    const copy = localizedTrackNotice(meta.trackId, meta.albumId, meta.trackId);
    if (
      nativeTaskFinished(task) ||
      fileLooksComplete(meta.trackId, meta.albumId, task.bytesTotal)
    ) {
      // Bind a still-running job so later `.done()` can stop() without deleting
      // the dest now. Size-based complete must not block the pump.
      if (!nativeTaskFinished(task) && !nativeTaskPaused(task)) {
        bindTask(task, meta, copy.title, copy.reciterName);
      }
      await finishTask(
        task.id,
        meta,
        copy.title,
        "completed",
        task.bytesDownloaded,
      );
      completedNotices.set(
        meta.mode === "batch"
          ? albumNotificationId(meta.albumId)
          : trackNotificationId(meta.trackId),
        {
          title:
            meta.mode === "batch"
              ? localizedAlbumNoticeTitle(meta.albumId)
              : copy.title,
          albumId: meta.albumId,
        },
      );
      if (nativeTaskFinished(task) && !nativeTaskPaused(task)) {
        void releaseNativeTask(task);
      }
      continue;
    }
    if (nativeTaskPaused(task) && Platform.OS !== "ios") {
      reattachedPaused.set(task.id, task);
      continue;
    }
    if (Platform.OS === "ios") {
      // Swipe-kill cancels URLSession. Those jobs come back PAUSED with -999
      // resume data that never ticks, and RUNNING zombies hold the 3 slots.
      // stop() drops the session temp; dest is only written on complete.
      await releaseNativeTask(task);
      continue;
    }
    // Leave running/pending UIDT jobs attached. stop() cancels the job and
    // deletes the dest; start() then hits cleanupStaleState and can fail
    // silently on Android 16.
    bindTask(task, meta, copy.title, copy.reciterName);
  }
  for (const task of unknown) {
    void releaseNativeTask(task);
  }
  if (Platform.OS === "ios") {
    // stop() cancel events must flush before enqueueLeftover start()s the same ids.
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
  }
}

async function reconcileDownloadNotifications(
  completedNotices: Map<string, { title: string; albumId: string }>,
): Promise<void> {
  const keepIds = new Set<string>();
  for (const albumId of albumBatches.keys()) {
    await notifyAlbum(albumId, true);
    keepIds.add(albumNotificationId(albumId));
  }
  const { files } = useDownloadStore.getState();
  for (const file of Object.values(files)) {
    if (file.status !== "queued" && file.status !== "downloading") {
      continue;
    }
    if (file.mode === "batch" || albumBatches.get(file.albumId)?.pending.has(file.trackId)) {
      continue;
    }
    const id = trackNotificationId(file.trackId);
    keepIds.add(id);
    const copy = localizedTrackNotice(file.trackId, file.albumId, file.trackId);
    const live = useDownloadStore.getState().progress[file.trackId];
    const percent =
      live && live.bytesTotal > 0
        ? (live.bytesDownloaded / live.bytesTotal) * 100
        : 0;
    await notifyTrack(
      file.trackId,
      copy.title,
      copy.reciterName,
      percent,
      file.albumId,
      true,
    );
  }
  await dismissStaleDownloadNotifications(keepIds);
  for (const [id, notice] of completedNotices) {
    if (keepIds.has(id)) {
      continue;
    }
    await showCompleteNotification({
      id,
      title: notice.title,
      body: isAlbumNotificationId(id)
        ? albumCompleteBody(notice.albumId)
        : i18n.t("download.notificationComplete"),
      albumId: notice.albumId,
    });
  }
}

async function runInitDownloads(): Promise<void> {
  ensureAudioDirectory();
  applyCellularPolicy();
  await waitForDownloadHydration();
  if (!useDownloadStore.persist.hasHydrated()) {
    useDownloadStore.persist.onFinishHydration(() => {
      rebuildAlbumBatches([], new Set());
      enqueueLeftoverInFlight();
      void reconcileDownloadNotifications(new Map());
    });
  }
  rebuildAlbumBatches([], new Set());
  hookDownloadResumeOnActive();
  if (!languageHooked) {
    languageHooked = true;
    i18n.on("languageChanged", () => {
      void relocalizeProgressNotifications();
    });
  }
  const completedNotices = new Map<string, { title: string; albumId: string }>();
  // Attach/scan would otherwise post complete toasts before the queue is moving.
  suppressDownloadNotices = true;
  try {
    await scanInFlightCompletions(completedNotices);
    await attachExistingTasks(completedNotices);
    enqueueLeftoverInFlight();
    pruneOrphans();
  } finally {
    suppressDownloadNotices = false;
  }
  // Notify-kit after the queue is moving. Querying displayed notices first
  // can hang after a swipe-kill and used to freeze restore entirely.
  try {
    await withTimeout(initDownloadNotifications(), 4000, undefined);
    await withTimeout(
      reconcileDownloadNotifications(completedNotices),
      4000,
      undefined,
    );
  } catch {
    // Shade must not block downloads.
  }
}

/** Singleton re-attach: hydrate, bind existing UIDT jobs, then notify-kit (querying shade first used to hang). */
export function initDownloads(): Promise<void> {
  if (!initPromise) {
    initPromise = mutex.runExclusive(() => runInitDownloads()).catch((error) => {
      // Failed restore must not stick; splash/Settings should be able to retry.
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}
