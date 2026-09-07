import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Clipboard from "expo-clipboard";
import * as Updates from "expo-updates";
import { Alert, Linking, Platform } from "react-native";

import i18n from "@/i18n";

const FEEDBACK_EMAIL = "contact@opensikhapps.com";

function orUnknown(value: string | number | null | undefined): string {
  if (value == null) {
    return "unknown";
  }
  const text = String(value).trim();
  return text.length > 0 ? text : "unknown";
}

function nativeBuild(): string {
  // Binary versionCode / CFBundleVersion. Not expoConfig — that can be wrong after an OTA.
  return orUnknown(Application.nativeBuildVersion);
}

function otaChannel(): string {
  // Updates.channel is EAS Update only; this app bakes expo-channel-name on the binary.
  const headers = Constants.expoConfig?.updates?.requestHeaders as
    | Record<string, string>
    | undefined;
  return orUnknown(Updates.channel ?? headers?.["expo-channel-name"]);
}

function versionBody(): string {
  const version = orUnknown(Constants.expoConfig?.version);
  const build = nativeBuild();
  const runtimeVersion = orUnknown(Updates.runtimeVersion);
  const os = `${Platform.OS} ${String(Platform.Version)}`;
  const channel = otaChannel();
  const updateId = Updates.updateId ?? "embedded";
  return i18n.t("feedback.mailBody", {
    version,
    build,
    runtimeVersion,
    os,
    channel,
    updateId,
  });
}

export async function openFeedbackMail(): Promise<void> {
  const subject = encodeURIComponent(i18n.t("feedback.mailSubject"));
  const body = encodeURIComponent(versionBody());
  const url = `mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`;
  const can = await Linking.canOpenURL(url);
  if (can) {
    await Linking.openURL(url);
    return;
  }
  // No mail app (some Android SKUs). Clipboard so they can paste into Gmail later.
  await Clipboard.setStringAsync(`${FEEDBACK_EMAIL}\n${versionBody()}`);
  Alert.alert(i18n.t("settings.giveFeedback"), i18n.t("feedback.copied"));
}
