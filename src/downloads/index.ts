/** Screens import this barrel — never `engine`, notify-kit, or Firebase. */
export type {
  AlbumBatchSnapshot,
  DownloadFile,
  DownloadSnackbar,
  DownloadStatus,
  DownloadTrackInput,
  EnqueueMode,
} from "@/downloads/types";
export { fileKey } from "@/downloads/types";
export { initNetwork, waitForNetworkSnapshot, isOnline, isCellular, useIsOnline, subscribeNetwork } from "@/downloads/network";
export {
  requestDownloadNotificationPermission,
  initDownloadNotificationOpens,
} from "@/downloads/notify";
export {
  albumFullyDownloaded,
  albumHasDownloads,
  fileForTrackOnAlbum,
  getFile,
  inFlightFilesForAlbum,
  isTrackDownloaded,
  isTrackDownloading,
  trackDownloadStatus,
  useDownloadStore,
} from "@/downloads/store";
export {
  enqueueDownloads,
  initDownloads,
  isCurrentlyPlayingTrack,
  isTrackDownloadHeldForPlayback,
  isTrackInQueue,
  playableUrlFor,
  pruneOrphans,
  removeDownloadedTracks,
  cancelDownloads,
  cancelAllInFlightDownloads,
  hasInFlightDownloads,
  syncDownloaderCellularPolicy,
} from "@/downloads/engine";
