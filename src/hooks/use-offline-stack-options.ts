import type { ComponentProps } from "react";
import { TextStyle } from "react-native";
import { Stack } from "expo-router";

import { useIsOnline } from "@/downloads";
import { useChrome } from "@/hooks/use-chrome";
import { useResolvedLocale } from "@/hooks/use-resolved-locale";
import { fontFamilyForLocale } from "@/i18n/locales";

type StackOptions = NonNullable<ComponentProps<typeof Stack>["screenOptions"]>;

/** Native headerTitleStyle cannot use NativeWind tokens — mirror useChrome title scale. */
function headerTitleFontSize(titleClass: string): number {
  if (titleClass.includes("text-4xl")) {
    return 36;
  }
  if (titleClass.includes("text-3xl")) {
    return 30;
  }
  return 24;
}

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
  const { title } = useChrome();
  // Native headers never go through `@/tw` Text, so Punjabi would stay system Gurmukhi.
  const fontFamily = fontFamilyForLocale(locale);
  const headerTitleStyle: TextStyle = {
    fontSize: headerTitleFontSize(title),
    ...(fontFamily ? { fontFamily } : {}),
  };
  const font = { headerTitleStyle } as StackOptions;
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
