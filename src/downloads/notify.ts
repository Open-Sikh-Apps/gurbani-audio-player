import notifee, { AndroidImportance, EventType } from "react-native-notify-kit";
import { AppState, Platform } from "react-native";
import { createMMKV } from "react-native-mmkv";

import { filesForTrack } from "@/downloads/store";
import i18n from "@/i18n";
import { useNotificationOpenStore } from "@/state/notification-open-store";

const CHANNEL_ID = "downloads";
const ALBUM_PREFIX = "dl-album-";
const TRACK_PREFIX = "dl-track-";
// Must match index.js headless handler (that file cannot import this module).
const PENDING_ALBUM_MMKV_ID = "notification-open";
const PENDING_ALBUM_KEY = "albumId";

let channelReady: Promise<void> | null = null;
let opensStarted = false;
const pendingAlbumMmkv = createMMKV({ id: PENDING_ALBUM_MMKV_ID });
// Finished-album notices must survive reconcile — dismissStale only keeps in-flight ids.
const completeNoticeIds = new Set<string>();

export async function requestDownloadNotificationPermission(): Promise<void> {
  await notifee.requestPermission();
}

export async function initDownloadNotifications(): Promise<void> {
  await ensureChannel();
}

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== "android") {
    return;
  }
  if (!channelReady) {
    channelReady = notifee
      .createChannel({
        id: CHANNEL_ID,
        name: i18n.t("download.notificationChannel"),
        // LOW: progress ticks every ~800ms must not heads-up or vibrate.
        importance: AndroidImportance.LOW,
        vibration: false,
      })
      .then(() => undefined);
  }
  await channelReady;
}

export async function relocalizeDownloadChannel(): Promise<void> {
  channelReady = null;
  await ensureChannel();
}

export function albumNotificationId(albumId: string): string {
  return `${ALBUM_PREFIX}${albumId}`;
}

export function trackNotificationId(trackId: string): string {
  return `${TRACK_PREFIX}${trackId}`;
}

export function isTrackNotificationId(id: string): boolean {
  return id.startsWith(TRACK_PREFIX);
}

export function trackIdFromDownloadNotificationId(id: string): string | null {
  return id.startsWith(TRACK_PREFIX) ? id.slice(TRACK_PREFIX.length) : null;
}

export function albumIdFromDownloadNotificationId(id: string): string | null {
  if (id.startsWith(ALBUM_PREFIX)) {
    return id.slice(ALBUM_PREFIX.length);
  }
  const trackId = trackIdFromDownloadNotificationId(id);
  if (!trackId) {
    return null;
  }
  return filesForTrack(trackId)[0]?.albumId ?? null;
}

function albumIdFromData(data: unknown): string | null {
  if (data == null || typeof data !== "object") {
    return null;
  }
  const albumId = (data as { albumId?: unknown }).albumId;
  return typeof albumId === "string" && albumId.length > 0 ? albumId : null;
}

function albumIdFromNotification(notification: {
  id?: string;
  data?: unknown;
} | undefined): string | null {
  const fromData = albumIdFromData(notification?.data);
  if (fromData) {
    return fromData;
  }
  const id = notification?.id;
  if (typeof id === "string" && id.startsWith(ALBUM_PREFIX)) {
    return id.slice(ALBUM_PREFIX.length);
  }
  if (typeof id === "string" && id.startsWith(TRACK_PREFIX)) {
    const trackId = id.slice(TRACK_PREFIX.length);
    return filesForTrack(trackId)[0]?.albumId ?? null;
  }
  return null;
}

function openAlbum(albumId: string): void {
  useNotificationOpenStore.getState().requestAlbum(albumId);
}

function consumePendingAlbumOpen(): void {
  const stored = pendingAlbumMmkv.getString(PENDING_ALBUM_KEY);
  if (!stored) {
    return;
  }
  pendingAlbumMmkv.remove(PENDING_ALBUM_KEY);
  openAlbum(stored);
}

export function initDownloadNotificationOpens(): void {
  if (opensStarted) {
    return;
  }
  opensStarted = true;
  notifee.onForegroundEvent(({ type, detail }) => {
    if (type !== EventType.PRESS && type !== EventType.ACTION_PRESS) {
      return;
    }
    const albumId = albumIdFromNotification(detail.notification);
    if (albumId) {
      openAlbum(albumId);
    }
  });
  void notifee.getInitialNotification().then((initial) => {
    const albumId = albumIdFromNotification(initial?.notification);
    if (albumId) {
      openAlbum(albumId);
    }
  });
  // Headless `index.js` wrote this while JS was dead; consume on every foreground.
  consumePendingAlbumOpen();
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      consumePendingAlbumOpen();
    }
  });
}

export async function showProgressNotification(options: {
  id: string;
  title: string;
  body: string;
  percent: number;
  albumId: string;
}): Promise<void> {
  await ensureChannel();
  completeNoticeIds.delete(options.id);
  const percent = Math.max(0, Math.min(100, Math.round(options.percent)));
  await notifee.displayNotification({
    id: options.id,
    title: options.title,
    body: options.body,
    data: { albumId: options.albumId },
    android: {
      channelId: CHANNEL_ID,
      // UIDT already holds the FGS; a second one from notify-kit crashes on Android 14+.
      asForegroundService: false,
      onlyAlertOnce: true,
      // Swipe-dismiss would hide the shade while the native job kept going.
      ongoing: true,
      progress: { max: 100, current: percent, indeterminate: false },
      pressAction: { id: "default", launchActivity: "default" },
      smallIcon: "notification_icon",
    },
    ios: {
      foregroundPresentationOptions: {
        // Shade list only — a banner would steal focus during playback.
        banner: false,
        list: true,
        sound: false,
      },
    },
  });
}

export async function showCompleteNotification(options: {
  id: string;
  title: string;
  body: string;
  albumId: string;
}): Promise<void> {
  await ensureChannel();
  completeNoticeIds.add(options.id);
  // Same id as the ongoing progress notice. Android keeps the progress bar
  // unless we drop that notification before posting the complete one.
  if (Platform.OS === "android") {
    await notifee.cancelNotification(options.id);
  }
  await notifee.displayNotification({
    id: options.id,
    title: options.title,
    body: options.body,
    data: { albumId: options.albumId },
    android: {
      channelId: CHANNEL_ID,
      asForegroundService: false,
      onlyAlertOnce: true,
      ongoing: false,
      pressAction: { id: "default", launchActivity: "default" },
      smallIcon: "notification_icon",
    },
    ios: {
      interruptionLevel: "active",
      foregroundPresentationOptions: {
        banner: false,
        list: true,
        sound: false,
      },
    },
  });
}

export async function cancelDownloadNotification(id: string): Promise<void> {
  completeNoticeIds.delete(id);
  await notifee.cancelNotification(id);
}

export async function displayedDownloadNotificationIds(): Promise<string[]> {
  const displayed = await notifee.getDisplayedNotifications();
  const ids: string[] = [];
  for (const item of displayed) {
    const id = item.notification?.id ?? item.id;
    if (typeof id !== "string") {
      continue;
    }
    if (id.startsWith(ALBUM_PREFIX) || id.startsWith(TRACK_PREFIX)) {
      ids.push(id);
    }
  }
  return ids;
}

export function isAlbumNotificationId(id: string): boolean {
  return id.startsWith(ALBUM_PREFIX);
}

export async function dismissStaleDownloadNotifications(
  keepIds: Set<string>,
): Promise<void> {
  const displayed = await displayedDownloadNotificationIds();
  for (const id of displayed) {
    if (keepIds.has(id) || completeNoticeIds.has(id)) {
      continue;
    }
    await notifee.cancelNotification(id);
  }
}

const LIBRARY_CHANNELS = new Set([
  "uidt_download_channel",
  "uidt_download_channel_silent",
  "uidt_download_channel_ultra_silent",
  "uidt_download_channel_finished",
  "resumable_download_channel",
  "resumable_download_channel_silent",
]);

/** Drop the downloader's silent UIDT/FGS stubs. Do not touch notify-kit or media. */
export async function dismissLibraryDownloadNotifications(): Promise<void> {
  if (Platform.OS !== "android") {
    return;
  }
  const displayed = await notifee.getDisplayedNotifications();
  for (const item of displayed) {
    const id = item.notification?.id ?? item.id;
    if (typeof id !== "string") {
      continue;
    }
    if (id.startsWith(ALBUM_PREFIX) || id.startsWith(TRACK_PREFIX)) {
      continue;
    }
    const channelId = item.notification?.android?.channelId;
    if (typeof channelId === "string" && LIBRARY_CHANNELS.has(channelId)) {
      await notifee.cancelNotification(id);
    }
  }
}
