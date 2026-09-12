import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { Alert, Linking, Platform } from "react-native";

import { reportOtaFetchFailure } from "@/crash/report";
import {
  cancelAllInFlightDownloads,
  hasInFlightDownloads,
  isOnline,
} from "@/downloads";
import i18n from "@/i18n";
import { pausePlayback, usePlaybackStore } from "@/playback";
import { usePreferencesStore } from "@/state/preferences-store";
import { useOtaApplyingStore } from "@/updates/applying";
import {
  isSameLaunchAsset,
  LAUNCH_HASH_EXTRA_PARAM,
  launchAssetHashFromManifest,
} from "@/updates/launch-hash";

/** App Store Connect Apple ID. Open store is offered on production iOS even before the public listing is live. */
const IOS_APP_STORE_ID = "6809691052";

/** One in-flight Worker check per JS lifetime so cold start and apply share a result. */
let probePromise: Promise<boolean> | null = null;

function isPlaybackBusy(): boolean {
  const status = usePlaybackStore.getState();
  return Boolean(status.playing || status.buffering);
}

function updatesReady(): boolean {
  return Platform.OS !== "web" && Updates.isEnabled;
}

/**
 * Fetch + reload. Overlay stays up on purpose: a `finally` that clears it can
 * flash a blank frame before `reloadAsync` tears down JS.
 */
async function applyUpdate(): Promise<boolean> {
  useOtaApplyingStore.getState().setApplying(true);
  try {
    // Pause first so resume is flushed to MMKV before the JS runtime is torn down.
    pausePlayback();
    await cancelAllInFlightDownloads();
    const result = await Updates.fetchUpdateAsync();
    if (!result.isNew) {
      useOtaApplyingStore.getState().setApplying(false);
      return false;
    }
    await Updates.reloadAsync();
    return true;
  } catch (error) {
    useOtaApplyingStore.getState().setApplying(false);
    await reportOtaFetchFailure(error);
    return false;
  }
}

function promptBusyApply(): void {
  Alert.alert(i18n.t("ota.busyTitle"), i18n.t("ota.busyBody"), [
    { text: i18n.t("ota.cancel"), style: "cancel" },
    {
      text: i18n.t("ota.apply"),
      onPress: () => {
        void applyUpdate().then((ok) => {
          if (!ok) {
            Alert.alert(i18n.t("ota.check"), i18n.t("ota.failed"));
          }
        });
      },
    },
  ]);
}

/** Idle cold-start only. One OK — not a second consent, just a wait heads-up. */
function promptSilentApply(): Promise<void> {
  return new Promise((resolve) => {
    Alert.alert(
      i18n.t("ota.silentTitle"),
      i18n.t("ota.silentBody"),
      [
        {
          text: i18n.t("ota.silentOk"),
          onPress: () => resolve(),
        },
      ],
      { cancelable: false },
    );
  });
}

/** Tell the Worker the running launch hash so it can 204 instead of a same-bytes manifest. */
async function advertiseRunningLaunchHash(): Promise<void> {
  const hash = launchAssetHashFromManifest(Updates.manifest);
  if (!hash) {
    return;
  }
  try {
    await Updates.setExtraParamAsync(LAUNCH_HASH_EXTRA_PARAM, hash);
  } catch {
    // Extra params are unavailable in Expo Go / when updates is disabled.
  }
}

async function remoteUpdateIsPending(): Promise<boolean> {
  await advertiseRunningLaunchHash();
  const check = await Updates.checkForUpdateAsync();
  if (!check.isAvailable) {
    return false;
  }
  // Native still says available when ids differ but Hermes bytes match (new APK vs just-published OTA).
  return !isSameLaunchAsset(Updates.manifest, check.manifest);
}

/** Manifest check only. Safe to start as soon as NetInfo says online. */
export function probeAppUpdate(): Promise<boolean> {
  if (probePromise) {
    return probePromise;
  }
  probePromise = (async () => {
    if (!updatesReady() || !isOnline()) {
      return false;
    }
    try {
      return await remoteUpdateIsPending();
    } catch {
      return false;
    }
  })();
  return probePromise;
}

export type ApplyPendingResult = "applied" | "busy" | "none";

export type ApplyPendingOptions = {
  promptIfBusy: boolean;
  /** Cold-start idle: warn before fetch. Settings already tapped Check — skip. */
  silentHeadsUp: boolean;
};

/**
 * Uses the in-flight probe. Call after MMKV + downloads init so busy/cancel
 * match native jobs. Does not fetch until the user has seen the idle heads-up
 * or confirmed the busy dialog.
 */
export async function applyPendingAppUpdate(
  options: ApplyPendingOptions,
): Promise<ApplyPendingResult> {
  const available = await probeAppUpdate();
  if (!available) {
    return "none";
  }
  const busy = isPlaybackBusy() || hasInFlightDownloads();
  if (busy) {
    if (options.promptIfBusy) {
      promptBusyApply();
    }
    return "busy";
  }
  // First install still has the wizard; Update ready would stack on top of it.
  if (
    options.silentHeadsUp &&
    usePreferencesStore.getState().hasCompletedWizard
  ) {
    await promptSilentApply();
  }
  const reloaded = await applyUpdate();
  return reloaded ? "applied" : "none";
}

function otaChannelName(): string | undefined {
  const headers = Constants.expoConfig?.updates?.requestHeaders as
    | Record<string, string>
    | undefined;
  const value = Updates.channel ?? headers?.["expo-channel-name"];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function storeListingUrl(): string | null {
  // Preview / USB must not open the production listing.
  if (Platform.OS === "web" || otaChannelName() !== "production") {
    return null;
  }
  if (Platform.OS === "android") {
    const id = Application.applicationId;
    return id ? `https://play.google.com/store/apps/details?id=${id}` : null;
  }
  if (Platform.OS === "ios" && IOS_APP_STORE_ID.length > 0) {
    return `https://apps.apple.com/app/id${IOS_APP_STORE_ID}`;
  }
  return null;
}

/** Settings Check only. Cold start must not offer the store. */
function promptNoJsUpdate(): void {
  const url = storeListingUrl();
  if (!url) {
    Alert.alert(i18n.t("ota.check"), i18n.t("ota.none"));
    return;
  }
  Alert.alert(i18n.t("ota.check"), i18n.t("ota.storeBody"), [
    { text: i18n.t("ota.cancel"), style: "cancel" },
    {
      text: i18n.t("ota.openStore"),
      onPress: () => {
        void Linking.openURL(url);
      },
    },
  ]);
}

/** Settings tile: fresh check, then apply. No idle heads-up — they tapped Check. */
export async function checkForAppUpdate(fromSettings: boolean): Promise<void> {
  if (!updatesReady()) {
    if (fromSettings) {
      Alert.alert(i18n.t("ota.check"), i18n.t("ota.disabled"));
    }
    return;
  }
  try {
    const pending = await remoteUpdateIsPending();
    if (!pending) {
      probePromise = Promise.resolve(false);
      if (fromSettings) {
        promptNoJsUpdate();
      }
      return;
    }
    // Share this result with a concurrent cold-start apply so it does not hit the Worker twice.
    probePromise = Promise.resolve(true);
    const busy = isPlaybackBusy() || hasInFlightDownloads();
    if (!busy) {
      const applied = await applyUpdate();
      if (!applied && fromSettings) {
        Alert.alert(i18n.t("ota.check"), i18n.t("ota.failed"));
      }
      return;
    }
    promptBusyApply();
  } catch {
    if (fromSettings) {
      Alert.alert(i18n.t("ota.check"), i18n.t("ota.failed"));
    }
  }
}
