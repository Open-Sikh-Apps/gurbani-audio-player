/** `orphan` = finished file whose trackId left the catalogue; keep until prune so the live session can still play. */
export type DownloadStatus =
  | "queued"
  | "downloading"
  | "completed"
  | "failed"
  | "orphan";

export type EnqueueMode = "batch" | "single";

export type DownloadFile = {
  trackId: string;
  albumId: string;
  remoteUrl: string;
  localPath: string;
  status: DownloadStatus;
  bytes?: number;
  updatedAt: number;
  // Needed after process death: batch vs single chooses album vs track notice.
  mode?: EnqueueMode;
};

export type DownloadTrackInput = {
  albumId: string;
  trackId: string;
  remoteUrl: string;
  byteSize: number;
  title: string;
  reciterName?: string;
  albumTitle?: string;
};

export type TrackProgress = {
  bytesDownloaded: number;
  bytesTotal: number;
};

export type AlbumBatchSnapshot = {
  percent: number;
  done: number;
  total: number;
};

export type DownloadSnackbar = {
  id: number;
  kind: "startedTrack" | "startedTracks" | "addedTracks" | "pausedForPlayback";
  count: number;
};

export function fileKey(trackId: string, remoteUrl: string): string {
  // URL is in the key so a catalogue URL change is a new file, not an overwrite of the old dest.
  return `${trackId}|${remoteUrl}`;
}
