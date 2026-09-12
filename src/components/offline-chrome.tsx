import { type ReactNode } from "react";
import { Platform } from "react-native";
import { useTranslation } from "react-i18next";
import {
  SafeAreaInsetsContext,
  initialWindowMetrics,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { useDownloadStore, useIsOnline } from "@/downloads";
import { useChrome } from "@/hooks/use-chrome";
import { Text, View, cn, ui } from "@/tw";

export function OfflineBanner() {
  const { t } = useTranslation();
  const { text } = useChrome();
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const hasDownloads = useDownloadStore((state) =>
    Object.values(state.files).some(
      (file) => file.status === "completed" || file.status === "orphan",
    ),
  );
  if (online) {
    return null;
  }
  // iOS fullScreenModal covers the root banner and inherits top:0 from OfflineChrome.
  // Window metrics still know the status-bar height.
  const top = Math.max(insets.top, initialWindowMetrics?.insets.top ?? 0);
  return (
    <View
      className={cn("gap-1 px-4 py-2", ui.fillAccent)}
      style={{ paddingTop: top + 8 }}
    >
      <Text className={cn("text-center font-semibold", ui.accentFg, text)}>
        {t("offline.banner")}
        {/* Only mention downloads when some files are actually on disk. */}
        {hasDownloads ? ` ${t("offline.bannerDownloads")}` : ""}
      </Text>
    </View>
  );
}

export function OfflineChrome({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  // Consume the top inset in the banner so JS chrome below does not pad twice.
  const provided = online ? insets : { ...insets, top: 0 };

  return (
    <SafeAreaInsetsContext.Provider value={provided}>
      <OfflineBanner />
      {children}
    </SafeAreaInsetsContext.Provider>
  );
}

/** Root OfflineChrome is covered by iOS `fullScreenModal`. Android still shows it. */
export function IosModalOfflineBanner() {
  if (Platform.OS !== "ios") {
    return null;
  }
  return <OfflineBanner />;
}
