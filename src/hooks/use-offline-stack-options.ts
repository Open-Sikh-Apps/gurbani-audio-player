import type { ComponentProps } from "react";
import { Platform } from "react-native";
import { Stack } from "expo-router";

import { useIsOnline } from "@/downloads";
import { useResolvedLocale } from "@/hooks/use-resolved-locale";
import { fontFamilyForLocale } from "@/i18n/locales";

type StackOptions = NonNullable<ComponentProps<typeof Stack>["screenOptions"]>;

/**
 * Nested stacks wrap SafeAreaProviderCompat, and on Android 15
 * `statusBarTranslucent` / `topInsetEnabled` no longer change the native header.
 * Expo's newer `unstable_headerInsets` is not in SDK 57's expo-router, so this
 * uses `disableTopInsetApplication`. `statusBarTranslucent: false` still drives
 * iOS `headerTopInsetEnabled` so the banner can own the status-bar inset.
 */
export function useOfflineStackOptions(): StackOptions {
  const online = useIsOnline();
  const locale = useResolvedLocale();
  // Native headers never go through `@/tw` Text, so Punjabi would stay Apple Gurmukhi.
  const fontFamily =
    Platform.OS === "ios" ? fontFamilyForLocale(locale) : undefined;
  const font: StackOptions = fontFamily
    ? { headerTitleStyle: { fontFamily } }
    : {};
  if (online) {
    return font;
  }
  return {
    ...font,
    statusBarTranslucent: false,
    navigationBarTranslucent: false,
    unstable_nativeProps: {
      headerConfig: {
        disableTopInsetApplication: true,
      },
    },
  } as StackOptions;
}
