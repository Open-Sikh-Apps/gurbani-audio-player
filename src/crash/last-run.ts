import * as Sentry from "@sentry/react-native";
import * as Updates from "expo-updates";
import { Alert } from "react-native";
import { createMMKV } from "react-native-mmkv";

import { openFeedbackMail } from "@/feedback/send";
import i18n from "@/i18n";

const IDENTITY_KEY = "launchIdentity";

let remembered = false;
let firstLaunchOfThisBundle = false;

function launchIdentity(): string {
  // Each OTA and each EAS binary embeds its own id; no native version needed.
  return Updates.updateId ?? "embedded";
}

/**
 * Stamp the running OTA/binary at JS start so a splash crash still counts as
 * this bundle, not the previous one.
 */
export function rememberLaunchBundle(): void {
  if (remembered) {
    return;
  }
  remembered = true;
  try {
    const mmkv = createMMKV({ id: "crash" });
    const current = launchIdentity();
    const previous = mmkv.getString(IDENTITY_KEY) ?? null;
    mmkv.set(IDENTITY_KEY, current);
    // crashedLastRun can stay true across reloadAsync (same process) and after a
    // store upgrade; only a failed OTA fallback should still surface the notice.
    firstLaunchOfThisBundle =
      previous !== current && !Updates.isEmergencyLaunch;
  } catch {
    // MMKV / Updates missing (web, Expo Go).
  }
}

export function isFirstLaunchOfThisBundle(): boolean {
  rememberLaunchBundle();
  return firstLaunchOfThisBundle;
}

/** Native crashes auto-send; tell the user on the next successful launch of this bundle. */
export async function maybeShowLastRunCrashAlert(): Promise<void> {
  try {
    if (isFirstLaunchOfThisBundle()) {
      return;
    }
    const crashed = await Sentry.crashedLastRun();
    if (crashed !== true) {
      return;
    }
    Alert.alert(i18n.t("crash.autoSentTitle"), i18n.t("crash.autoSentBody"), [
      { text: i18n.t("intro.dismiss"), style: "cancel" },
      {
        text: i18n.t("crash.email"),
        onPress: () => {
          void openFeedbackMail();
        },
      },
    ]);
  } catch {
    // Native module missing (web / Expo Go).
  }
}
