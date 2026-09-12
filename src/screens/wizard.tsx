import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Linking, Platform } from "react-native";

import { requestDownloadNotificationPermission } from "@/downloads";
import { AppToastSlot } from "@/feedback/toast";
import { useChrome } from "@/hooks/use-chrome";
import { useResolvedLocale } from "@/hooks/use-resolved-locale";
import { useSafeBottomPad } from "@/hooks/use-safe-bottom-pad";
import { UI_LOCALES } from "@/i18n/locales";
import { requestNotificationPermission } from "@/playback";
import { usePreferencesStore } from "@/state/preferences-store";
import { Pressable, ScrollView, Text, View, cn, ui } from "@/tw";

export function WizardScreen() {
  const { t } = useTranslation();
  const { hit, text, title, body, bodySmall, simpleMode } = useChrome();
  const locale = useResolvedLocale();
  const setLocale = usePreferencesStore((state) => state.setLocale);
  const setSimpleMode = usePreferencesStore((state) => state.setSimpleMode);
  const completeWizard = usePreferencesStore((state) => state.completeWizard);
  // Android adds a battery step after notifications; iOS finishes at step 2.
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const bottomPad = useSafeBottomPad();

  const finishWizard = () => {
    completeWizard({ locale, simpleMode });
  };

  return (
    <View className="relative flex-1">
    <ScrollView
      className={cn("flex-1", ui.page)}
      contentContainerClassName="flex-grow px-6 py-8"
      style={{ paddingBottom: bottomPad }}
    >
      {/* Language first so Simple mode and notification copy are already localized. */}
      {step === 0 ? (
        <View className="flex-1 justify-center gap-6">
          <View className="gap-2">
            <Text className={cn(ui.text, title)}>
              {t("wizard.languageTitle")}
            </Text>
            <Text className={cn(ui.muted, body)}>
              {t("wizard.languageSubtitle")}
            </Text>
          </View>
          <View className="gap-3">
            {/* Wizard requires an explicit language; Settings can later pick System. */}
            {UI_LOCALES.map((item) => {
              const selected = item.code === locale;
              return (
                <Pressable
                  key={item.code}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  className={cn(
                    "items-center justify-center rounded-2xl border px-4",
                    hit,
                    selected ? ui.selected : ui.unselected,
                  )}
                  onPress={() => setLocale(item.code)}
                >
                  <Text
                    className={cn(
                      "font-semibold",
                      text,
                      selected ? ui.accentFg : ui.text,
                    )}
                  >
                    {item.nativeName}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            accessibilityRole="button"
            className={cn(
              "items-center justify-center rounded-2xl px-4",
              hit,
              ui.fillAccent,
            )}
            onPress={() => setStep(1)}
          >
            <Text className={cn("font-semibold", ui.accentFg, text)}>
              {t("wizard.continue")}
            </Text>
          </Pressable>
        </View>
      ) : step === 1 ? (
        <View className="flex-1 justify-center gap-6">
          <View className="gap-2">
            <Text className={cn(ui.text, title)}>
              {t("wizard.simpleModeTitle")}
            </Text>
            <Text className={cn(ui.muted, body)}>
              {t("wizard.simpleModeBody")}
            </Text>
          </View>
          <View className="gap-3">
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: !simpleMode }}
              className={cn(
                "items-center justify-center rounded-2xl border px-4",
                hit,
                !simpleMode ? ui.selected : ui.unselected,
              )}
              onPress={() => setSimpleMode(false)}
            >
              <Text
                className={cn(
                  "font-semibold",
                  text,
                  !simpleMode ? ui.accentFg : ui.text,
                )}
              >
                {t("wizard.simpleModeOff")}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: simpleMode }}
              className={cn(
                "items-center justify-center rounded-2xl border px-4",
                hit,
                simpleMode ? ui.selected : ui.unselected,
              )}
              onPress={() => setSimpleMode(true)}
            >
              <Text
                className={cn(
                  "font-semibold",
                  text,
                  simpleMode ? ui.accentFg : ui.text,
                )}
              >
                {t("wizard.simpleModeOn")}
              </Text>
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            className={cn(
              "items-center justify-center rounded-2xl px-4",
              hit,
              ui.fillAccent,
            )}
            onPress={() => setStep(2)}
          >
            <Text className={cn("font-semibold", ui.accentFg, text)}>
              {t("wizard.continue")}
            </Text>
          </Pressable>
        </View>
      ) : step === 2 ? (
        <View className="flex-1 justify-center gap-6">
          <View className="gap-2">
            <Text className={cn(ui.text, title)}>
              {t("wizard.notificationsTitle")}
            </Text>
            <Text className={cn(ui.muted, body)}>
              {t("wizard.notificationsBody")}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            className={cn(
              "items-center justify-center rounded-2xl px-4",
              hit,
              ui.fillAccent,
            )}
            onPress={() => {
              void (async () => {
                // Playback shade + download progress both need a grant; do not leave this step until both run.
                await requestDownloadNotificationPermission();
                await requestNotificationPermission();
                if (Platform.OS === "android") {
                  setStep(3);
                  return;
                }
                finishWizard();
              })();
            }}
          >
            <Text className={cn("font-semibold", ui.accentFg, text)}>
              {Platform.OS === "android"
                ? t("wizard.continue")
                : t("wizard.done")}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View className="flex-1 justify-center gap-6">
          <View className="gap-2">
            <Text className={cn(ui.text, title)}>
              {t("settings.unrestrictedBattery")}
            </Text>
            <Text className={cn(ui.muted, body)}>
              {t("settings.unrestrictedBatteryHint")}
            </Text>
            <Text className={cn(ui.muted, bodySmall)}>
              {t("wizard.batteryLaterInSettings")}
            </Text>
          </View>
          <View className="gap-3">
            <Pressable
              accessibilityRole="button"
              className={cn(
                "items-center justify-center rounded-2xl px-4",
                hit,
                ui.fillAccent,
              )}
              // OEM battery pages are not reliably deep-linkable; open app settings instead.
              onPress={() => {
                void Linking.openSettings();
                finishWizard();
              }}
            >
              <Text className={cn("font-semibold", ui.accentFg, text)}>
                {t("wizard.batteryOpenSettings")}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              className={cn(
                "items-center justify-center rounded-2xl border px-4",
                hit,
                ui.unselected,
              )}
              onPress={finishWizard}
            >
              <Text className={cn("font-semibold", ui.text, text)}>
                {t("wizard.skip")}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </ScrollView>
    {/* Wizard is outside the tab bar, so it needs its own slot (padSafeArea docks above the home indicator). */}
    <AppToastSlot padSafeArea />
    </View>
  );
}
