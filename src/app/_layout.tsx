import "@/global.css";
import "@/i18n";

import { useFonts } from "expo-font";
import { Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { SystemBars } from "react-native-edge-to-edge";

import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";

import { CrashErrorBoundary } from "@/crash/error-boundary";
import { CrashLastRunNotice } from "@/crash/last-run-notice";
import { hydrateCatalogue, refreshCatalogue } from "@/catalogue";
import { DownloadToastBridge } from "@/components/download-toast-bridge";
import { FlushNotificationOpens } from "@/components/flush-notification-opens";
import { OfflineChrome } from "@/components/offline-chrome";
import { PlaybackKeepAwake } from "@/components/playback-keep-awake";
import {
  initDownloads,
  initDownloadNotificationOpens,
  isOnline,
  syncDownloaderCellularPolicy,
  useIsOnline,
  waitForNetworkSnapshot,
} from "@/downloads";
import { useResolvedLocale } from "@/hooks/use-resolved-locale";
import i18n from "@/i18n";
import {
  initPlayback,
  restoreLastSession,
  setRemotePrimary as applyRemotePrimary,
} from "@/playback";
import { usePreferencesStore } from "@/state/preferences-store";
import { waitAppPersisted } from "@/state/wait-persisted";
import { clearStaleIosAuth } from "@/native/ios-fresh-install";
import { applyPendingAppUpdate, probeAppUpdate } from "@/updates/check";
import { JsSplash, OtaApplyingOverlay } from "@/updates/applying";
import {
  applyCssColorScheme,
  applySystemBackground,
  applyThemePreference,
} from "@/theme/apply-theme";
import { navigationTheme } from "@/theme/navigation";
import {
  schemeFromDark,
  useIsDark,
  useThemeColors,
} from "@/theme/use-theme-colors";
import { View, cn, ui } from "@/tw";

// Keep Settings / Now Playing / Bookmarks stacked on tabs so dismissing a modal returns to Home, not an empty root.
export const unstable_settings = {
  anchor: "(tabs)",
};

// Survive activity remount from a notification tap so we skip the splash gate and keep Stack mounted.
let catalogueReady = false;

// Splash wait caps, not fetch deadlines — refresh/probe continue after first paint.
const CATALOGUE_REFRESH_SPLASH_MS = 5000;
const OTA_PROBE_SPLASH_MS = 8000;

async function hideNativeSplash(): Promise<void> {
  try {
    await SplashScreen.hideAsync();
  } catch {
    // Already gone, or this binary has no splash plugin yet.
  }
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    // Android still looks up this alias; iOS looks up the PostScript filename.
    NotoSansGurmukhi: require("../../assets/fonts/NotoSansGurmukhi-Regular.ttf"),
    "NotoSansGurmukhi-Regular": require("../../assets/fonts/NotoSansGurmukhi-Regular.ttf"),
    "NotoSansGurmukhi-Medium": require("../../assets/fonts/NotoSansGurmukhi-Medium.ttf"),
    "NotoSansGurmukhi-SemiBold": require("../../assets/fonts/NotoSansGurmukhi-SemiBold.ttf"),
    "NotoSansGurmukhi-Bold": require("../../assets/fonts/NotoSansGurmukhi-Bold.ttf"),
  });
  const hasCompletedWizard = usePreferencesStore(
    (state) => state.hasCompletedWizard,
  );
  const locale = useResolvedLocale();
  const theme = usePreferencesStore((state) => state.theme);
  const wifiOnlyDownloads = usePreferencesStore((state) => state.wifiOnlyDownloads);
  const remotePrimary = usePreferencesStore((state) => state.remotePrimary);
  const isDark = useIsDark();
  const colors = useThemeColors();
  const [ready, setReady] = useState(catalogueReady);
  // Stay mounted through the fade so Home paints under the splash instead of popping in.
  const [splashHeld, setSplashHeld] = useState(!catalogueReady);
  const online = useIsOnline();
  const navigationBarStyle = isDark ? "light" : "dark";
  // Invert status-bar icons while offline so they stay readable on the accent banner.
  const statusBarStyle = online ? navigationBarStyle : isDark ? "dark" : "light";

  useEffect(() => {
    // Native splash looks stuck; JS splash (spinner) is the wait UI from here on.
    void hideNativeSplash();
    // Lock-screen / headset session should exist during the spinner, not only after first paint.
    initPlayback();
    let cancelled = false;
    void (async () => {
      // First NetInfo callback can be wrong; wait so we neither skip a real online probe nor hit the Worker offline.
      await waitForNetworkSnapshot();
      if (cancelled || !isOnline()) {
        return;
      }
      // One shared promise for the process; overlapping font load means the splash-bound race often already has a result.
      void probeAppUpdate();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Noto must be in before the idle OTA dialog so Punjabi copy does not flash.
    if (!fontsLoaded && !fontError) {
      return;
    }
    if (catalogueReady) {
      // Native player can die with the Activity; this is a no-op if the session is still there.
      void restoreLastSession();
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await waitAppPersisted();
        // Keychain outlives delete+reinstall; MMKV does not. Wizard-not-done means a fresh sandbox.
        if (Platform.OS === "ios" && !usePreferencesStore.getState().hasCompletedWizard) {
          void clearStaleIosAuth();
        }
        await hydrateCatalogue();
        catalogueReady = true;
        await restoreLastSession();
        // Don't hold the spinner on a slow Pages fetch; the store keeps refreshing after paint.
        // Restore again if hydrate was bundled/cache-miss and Pages now has the album.
        const refreshed = refreshCatalogue().then(() => restoreLastSession());
        await Promise.race([
          refreshed,
          new Promise<void>((resolve) => {
            setTimeout(resolve, CATALOGUE_REFRESH_SPLASH_MS);
          }),
        ]);
      } finally {
        if (cancelled) {
          return;
        }
        // Same cap for the update check so a hung Worker cannot trap the spinner.
        const probed = await Promise.race([
          probeAppUpdate(),
          new Promise<null>((resolve) => {
            setTimeout(() => resolve(null), OTA_PROBE_SPLASH_MS);
          }),
        ]);
        if (probed === true) {
          // Re-attach jobs first so apply can pause/cancel instead of racing native work.
          await initDownloads();
          try {
            const outcome = await applyPendingAppUpdate({
              promptIfBusy: false,
              silentHeadsUp: true,
            });
            if (outcome === "applied") {
              // reloadAsync is tearing down JS; painting the old bundle would flash.
              return;
            }
            setReady(true);
            if (outcome === "busy") {
              // Silent apply skipped while downloads/playback ran; the dialog needs this tree mounted.
              void applyPendingAppUpdate({
                promptIfBusy: true,
                silentHeadsUp: false,
              });
            }
            return;
          } catch {
            // Fall through to first paint.
          }
        }
        setReady(true);
        void initDownloads();
        if (probed === null) {
          // Splash cap elapsed with no result; paint now and finish the check in the background.
          void probeAppUpdate().then(async (available) => {
            if (!available) {
              return;
            }
            await initDownloads();
            try {
              await applyPendingAppUpdate({
                promptIfBusy: true,
                silentHeadsUp: true,
              });
            } catch {
              // Settings can retry.
            }
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fontError, fontsLoaded]);

  useEffect(() => {
    void i18n.changeLanguage(locale);
  }, [locale]);

  useEffect(() => {
    applyThemePreference(theme);
  }, [theme]);

  useEffect(() => {
    applyRemotePrimary(remotePrimary);
  }, [remotePrimary]);

  useEffect(() => {
    // Native jobs read this config, not MMKV; keep it aligned with the preference.
    syncDownloaderCellularPolicy();
  }, [wifiOnlyDownloads]);

  useEffect(() => {
    if (!hasCompletedWizard || !ready) {
      return;
    }
    // Wizard owns the first permission prompt; tapping a download notification is a no-op before that.
    initDownloadNotificationOpens();
  }, [hasCompletedWizard, ready]);

  useEffect(() => {
    function applyChrome(): void {
      applyCssColorScheme(schemeFromDark(isDark));
      applySystemBackground(colors.bg);
    }
    applyChrome();
    const sub = AppState.addEventListener("change", (state) => {
      // Android drops SystemUI background and CSS scheme after an activity recreate (notification remount).
      if (state === "active") {
        applyChrome();
      }
    });
    return () => {
      sub.remove();
    };
  }, [colors.bg, isDark]);

  const chrome = (
    <>
      <SystemBars
        style={{ navigationBar: navigationBarStyle, statusBar: statusBarStyle }}
      />
    </>
  );

  // Native splash is already hidden; this spinner holds first paint until hydrate + OTA gate. Must not return null — that dropped Stack on remount.
  return (
    <CrashErrorBoundary>
      <ThemeProvider value={navigationTheme(isDark, colors)}>
        <View className="flex-1">
          {ready ? (
            <OfflineChrome>
              <View className={cn("flex-1", ui.page)}>
                <PlaybackKeepAwake />
                <Stack
                  screenOptions={{
                    headerShown: false,
                  }}
                >
                  <Stack.Protected guard={!hasCompletedWizard}>
                    <Stack.Screen name="wizard" />
                  </Stack.Protected>
                  <Stack.Protected guard={hasCompletedWizard}>
                    <Stack.Screen name="(tabs)" />
                    <Stack.Screen
                      name="settings"
                      options={{
                        presentation: "fullScreenModal",
                        headerShown: false,
                      }}
                    />
                    <Stack.Screen
                      name="now-playing"
                      options={{
                        presentation: "fullScreenModal",
                        headerShown: false,
                      }}
                    />
                    <Stack.Screen
                      name="bookmarks"
                      options={{
                        presentation: "fullScreenModal",
                        headerShown: false,
                      }}
                    />
                  </Stack.Protected>
                </Stack>
                <FlushNotificationOpens />
                <DownloadToastBridge />
                <CrashLastRunNotice />
                <OtaApplyingOverlay />
              </View>
            </OfflineChrome>
          ) : null}
          {splashHeld ? (
            <JsSplash hold={!ready} onHidden={() => setSplashHeld(false)} />
          ) : null}
          {chrome}
        </View>
      </ThemeProvider>
    </CrashErrorBoundary>
  );
}
