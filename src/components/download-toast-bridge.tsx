import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useDownloadStore } from "@/downloads";
import { showToast } from "@/feedback/toast";

/** Maps the download store snackbar to the shared bottom toast. */
export function DownloadToastBridge() {
  const { t } = useTranslation();
  const snackbar = useDownloadStore((state) => state.snackbar);
  const clearSnackbar = useDownloadStore((state) => state.clearSnackbar);

  useEffect(() => {
    if (!snackbar) {
      return;
    }
    const message =
      snackbar.kind === "pausedForPlayback"
        ? t("download.pausedWhilePlaying")
        : snackbar.kind === "startedTrack"
          ? t("download.startedTrack")
          : snackbar.kind === "addedTracks"
            ? t("download.addedTracks", { count: snackbar.count })
            : t("download.startedTracks", { count: snackbar.count });
    showToast(message);
    // Consume immediately so a later store tick does not re-show the same toast.
    clearSnackbar(snackbar.id);
  }, [clearSnackbar, snackbar, t]);

  return null;
}
