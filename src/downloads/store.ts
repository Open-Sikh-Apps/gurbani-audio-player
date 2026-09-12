import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { Platform } from "react-native";

import { downloadsStateStorage } from "@/state/mmkv";
import { usePlaybackStore } from "@/playback/status-store";
import {
  fileKey,
  type AlbumBatchSnapshot,
  type DownloadFile,
  type DownloadSnackbar,
  type DownloadStatus,
  type TrackProgress,
} from "@/downloads/types";

type DownloadsState = {
  files: Record<string, DownloadFile>;
  progress: Record<string, TrackProgress>;
  batches: Record<string, AlbumBatchSnapshot>;
  byTrackId: Record<string, string[]>;
  inFlightByAlbum: Record<string, string[]>;
  snackbar: DownloadSnackbar | null;
  upsertFile: (file: DownloadFile) => void;
  upsertFiles: (files: DownloadFile[]) => void;
  patchFile: (key: string, patch: Partial<DownloadFile>) => void;
  removeFile: (key: string) => void;
  setProgress: (trackId: string, progress: TrackProgress | null) => void;
  setBatch: (albumId: string, snapshot: AlbumBatchSnapshot | null) => void;
  showSnackbar: (snackbar: Omit<DownloadSnackbar, "id">) => void;
  clearSnackbar: (id: number) => void;
};

let snackbarSeq = 0;
let deferredDownloadsPersist: { name: string; value: string } | null = null;

const playbackAwareDownloadsStorage: StateStorage = {
  getItem: (name) => downloadsStateStorage.getItem(name),
  removeItem: (name) => downloadsStateStorage.removeItem(name),
  setItem: (name, value) => {
    // iOS: serializing the whole files map to MMKV on every complete starved
    // the UI while AVPlayer was live (scrubber froze ~10s in, JS still finishing jobs).
    if (Platform.OS === "ios") {
      const status = usePlaybackStore.getState();
      if (status.playing || status.buffering) {
        deferredDownloadsPersist = { name, value };
        return;
      }
    }
    downloadsStateStorage.setItem(name, value);
  },
};

/** Call when playback is idle so deferred MMKV writes land. Disk files are already there. */
export function flushDeferredDownloadsPersist(): void {
  if (!deferredDownloadsPersist) {
    return;
  }
  downloadsStateStorage.setItem(
    deferredDownloadsPersist.name,
    deferredDownloadsPersist.value,
  );
  deferredDownloadsPersist = null;
}

function isInFlight(status: DownloadStatus): boolean {
  return status === "queued" || status === "downloading";
}

function isKeptOnDisk(status: DownloadStatus): boolean {
  return status === "completed" || status === "orphan";
}

// Rebuild on each files write so byTrackId / inFlightByAlbum stay in lockstep with `files`.
function indexesFromFiles(files: Record<string, DownloadFile>): Pick<
  DownloadsState,
  "byTrackId" | "inFlightByAlbum"
> {
  const byTrackId: Record<string, string[]> = {};
  const inFlightByAlbum: Record<string, string[]> = {};
  for (const [key, file] of Object.entries(files)) {
    const trackKeys = byTrackId[file.trackId];
    if (trackKeys) {
      trackKeys.push(key);
    } else {
      byTrackId[file.trackId] = [key];
    }
    if (isInFlight(file.status)) {
      const albumKeys = inFlightByAlbum[file.albumId];
      if (albumKeys) {
        albumKeys.push(key);
      } else {
        inFlightByAlbum[file.albumId] = [key];
      }
    }
  }
  return { byTrackId, inFlightByAlbum };
}

// Header reads `batches` from the store. Rebuild from files on hydrate so a
// swipe-kill does not wait on the download engine to show 8/143 again.
function batchSnapshotsFromFiles(
  files: Record<string, DownloadFile>,
): Record<string, AlbumBatchSnapshot> {
  const pendingByAlbum: Record<string, number> = {};
  const completedByAlbum: Record<string, number> = {};
  const hasExplicitBatch: Record<string, boolean> = {};
  for (const file of Object.values(files)) {
    if (file.status === "completed") {
      completedByAlbum[file.albumId] =
        (completedByAlbum[file.albumId] ?? 0) + 1;
    }
    if (!isInFlight(file.status) || file.mode === "single") {
      continue;
    }
    pendingByAlbum[file.albumId] = (pendingByAlbum[file.albumId] ?? 0) + 1;
    if (file.mode === "batch") {
      hasExplicitBatch[file.albumId] = true;
    }
  }
  const batches: Record<string, AlbumBatchSnapshot> = {};
  for (const [albumId, pending] of Object.entries(pendingByAlbum)) {
    if (pending === 0) {
      continue;
    }
    if (!hasExplicitBatch[albumId] && pending === 1) {
      continue;
    }
    const done = completedByAlbum[albumId] ?? 0;
    const total = done + pending;
    batches[albumId] = {
      done,
      total,
      percent: total > 0 ? (done / total) * 100 : 0,
    };
  }
  return batches;
}

function asPersistedFiles(
  persisted: unknown,
  fallback: Record<string, DownloadFile>,
): Record<string, DownloadFile> {
  if (!persisted || typeof persisted !== "object" || !("files" in persisted)) {
    return fallback;
  }
  const raw = persisted.files;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }
  const files: Record<string, DownloadFile> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const file = value as DownloadFile;
    // Skip corrupt MMKV rows so hydrate cannot throw and leave hasHydrated false.
    if (
      typeof file.trackId !== "string" ||
      typeof file.status !== "string" ||
      typeof file.albumId !== "string" ||
      typeof file.remoteUrl !== "string"
    ) {
      continue;
    }
    files[key] = file;
  }
  if (Object.keys(raw).length > 0 && Object.keys(files).length === 0) {
    return fallback;
  }
  return files;
}

export const useDownloadStore = create<DownloadsState>()(
  persist(
    (set, get) => ({
      files: {},
      progress: {},
      batches: {},
      byTrackId: {},
      inFlightByAlbum: {},
      snackbar: null,
      upsertFile: (file) => {
        const key = fileKey(file.trackId, file.remoteUrl);
        const files = { ...get().files, [key]: file };
        set({ files, ...indexesFromFiles(files) });
      },
      upsertFiles: (incoming) => {
        if (incoming.length === 0) {
          return;
        }
        const files = { ...get().files };
        for (const file of incoming) {
          files[fileKey(file.trackId, file.remoteUrl)] = file;
        }
        set({ files, ...indexesFromFiles(files) });
      },
      patchFile: (key, patch) => {
        const current = get().files[key];
        if (!current) {
          return;
        }
        const next = { ...current, ...patch, updatedAt: Date.now() };
        const files = { ...get().files, [key]: next };
        if (current.status === next.status) {
          set({ files });
          return;
        }
        const inFlightByAlbum = { ...get().inFlightByAlbum };
        const albumId = next.albumId;
        const without = (inFlightByAlbum[albumId] ?? []).filter((item) => item !== key);
        if (isInFlight(next.status)) {
          inFlightByAlbum[albumId] = [...without, key];
        } else if (without.length > 0) {
          inFlightByAlbum[albumId] = without;
        } else {
          delete inFlightByAlbum[albumId];
        }
        set({
          files,
          byTrackId: get().byTrackId,
          inFlightByAlbum,
        });
      },
      removeFile: (key) => {
        const current = get().files[key];
        if (!current) {
          return;
        }
        const files = { ...get().files };
        delete files[key];
        set({ files, ...indexesFromFiles(files) });
      },
      setProgress: (trackId, progress) =>
        set((state) => {
          if (!progress) {
            if (state.progress[trackId] == null) {
              return state;
            }
            const next = { ...state.progress };
            delete next[trackId];
            return { progress: next };
          }
          return { progress: { ...state.progress, [trackId]: progress } };
        }),
      setBatch: (albumId, snapshot) =>
        set((state) => {
          if (!snapshot) {
            if (state.batches[albumId] == null) {
              return state;
            }
            const batches = { ...state.batches };
            delete batches[albumId];
            return { batches };
          }
          const prev = state.batches[albumId];
          if (
            prev &&
            prev.percent === snapshot.percent &&
            prev.done === snapshot.done &&
            prev.total === snapshot.total
          ) {
            // UIDT progress ticks often repeat; skip so the album header does not re-render 3×/s.
            return state;
          }
          return { batches: { ...state.batches, [albumId]: snapshot } };
        }),
      showSnackbar: (snackbar) => {
        snackbarSeq += 1;
        set({ snackbar: { ...snackbar, id: snackbarSeq } });
      },
      clearSnackbar: (id) => {
        // Id must match so a stale timer does not hide a newer toast.
        if (get().snackbar?.id === id) {
          set({ snackbar: null });
        }
      },
    }),
    {
      name: "downloads",
      storage: createJSONStorage(() => playbackAwareDownloadsStorage),
      // Progress and batches are derived. Persisting them would fight the engine after a swipe-kill.
      partialize: (state) => ({ files: state.files }),
      merge: (persisted, current) => {
        const files = asPersistedFiles(persisted, current.files);
        // Indexes must land in the same replace-merge as `files`.
        return {
          ...current,
          files,
          ...indexesFromFiles(files),
          batches: batchSnapshotsFromFiles(files),
        };
      },
    },
  ),
);

export function batchSnapshotForAlbum(
  albumId: string,
  files: Record<string, DownloadFile> = useDownloadStore.getState().files,
): AlbumBatchSnapshot | null {
  return batchSnapshotsFromFiles(files)[albumId] ?? null;
}

export function refreshBatchesFromFiles(): void {
  useDownloadStore.setState({
    batches: batchSnapshotsFromFiles(useDownloadStore.getState().files),
  });
}

export function getFile(
  trackId: string,
  remoteUrl: string,
): DownloadFile | undefined {
  return useDownloadStore.getState().files[fileKey(trackId, remoteUrl)];
}

export function filesForTrack(trackId: string): DownloadFile[] {
  const { files, byTrackId } = useDownloadStore.getState();
  const keys = byTrackId[trackId];
  if (!keys) {
    return [];
  }
  const out: DownloadFile[] = [];
  for (const key of keys) {
    const file = files[key];
    if (file) {
      out.push(file);
    }
  }
  return out;
}

export function isTrackDownloaded(trackId: string, remoteUrl: string): boolean {
  const file = getFile(trackId, remoteUrl);
  return file?.status === "completed";
}

export function isTrackDownloading(trackId: string): boolean {
  const { files, byTrackId } = useDownloadStore.getState();
  const keys = byTrackId[trackId];
  if (!keys) {
    return false;
  }
  for (const key of keys) {
    const file = files[key];
    if (file && isInFlight(file.status)) {
      return true;
    }
  }
  return false;
}

export function trackDownloadStatus(
  trackId: string,
  remoteUrl: string,
): DownloadStatus | null {
  const { files, byTrackId } = useDownloadStore.getState();
  const keys = byTrackId[trackId];
  if (keys) {
    for (const key of keys) {
      const file = files[key];
      if (file && isInFlight(file.status)) {
        return file.status;
      }
    }
  }
  return getFile(trackId, remoteUrl)?.status ?? null;
}

export function albumFullyDownloaded(
  tracks: { id: string; url: string }[],
): boolean {
  if (tracks.length === 0) {
    return false;
  }
  const { files } = useDownloadStore.getState();
  return tracks.every(
    (track) => files[fileKey(track.id, track.url)]?.status === "completed",
  );
}

export function albumHasDownloads(
  tracks: { id: string; url: string }[],
): boolean {
  const { files } = useDownloadStore.getState();
  return tracks.some(
    (track) => files[fileKey(track.id, track.url)]?.status === "completed",
  );
}

export function inFlightFilesForAlbum(albumId: string): DownloadFile[] {
  const { files, inFlightByAlbum } = useDownloadStore.getState();
  const keys = inFlightByAlbum[albumId];
  if (!keys) {
    return [];
  }
  const out: DownloadFile[] = [];
  for (const key of keys) {
    const file = files[key];
    if (file) {
      out.push(file);
    }
  }
  return out;
}

export function fileForTrackOnAlbum(
  trackId: string,
  albumId: string,
): DownloadFile | undefined {
  const { files, byTrackId } = useDownloadStore.getState();
  const keys = byTrackId[trackId];
  if (!keys) {
    return undefined;
  }
  for (const key of keys) {
    const file = files[key];
    if (file?.albumId === albumId) {
      return file;
    }
  }
  return undefined;
}
