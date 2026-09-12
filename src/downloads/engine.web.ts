import type { DownloadTrackInput, EnqueueMode } from "@/downloads/types";

/** Metro web stub — native downloads are unavailable; same names so screens stay platform-free. */
export function syncDownloaderCellularPolicy(): void {}

export function isTrackInQueue(_trackId: string): boolean {
  return false;
}

export function isCurrentlyPlayingTrack(_trackId: string): boolean {
  return false;
}

export function isTrackDownloadHeldForPlayback(
  _trackId: string,
  _status?: unknown,
): boolean {
  return false;
}

export function playableUrlFor(
  _trackId: string,
  _remoteUrl: string,
): string | null {
  return null;
}

export async function enqueueDownloads(
  _tracks: DownloadTrackInput[],
  _mode: EnqueueMode,
): Promise<"started" | "added" | "noop" | "blocked"> {
  return "blocked";
}

export async function removeDownloadedTracks(
  _tracks: DownloadTrackInput[],
): Promise<void> {}

export async function cancelDownloads(
  _tracks: DownloadTrackInput[],
): Promise<void> {}

export function hasInFlightDownloads(): boolean {
  return false;
}

export async function cancelAllInFlightDownloads(): Promise<void> {}

export function pruneOrphans(): void {}

export async function initDownloads(): Promise<void> {}
