import { getLocales } from "expo-localization";
import { Platform } from "react-native";

import { UI_LOCALES, FALLBACK_LOCALE, SYSTEM_LOCALE, type UiLocale } from "@/i18n/locales-constants";
export { UI_LOCALES, FALLBACK_LOCALE, SYSTEM_LOCALE, SUPPORTED_LOCALE_CODES, type UiLocale } from "@/i18n/locales-constants";

export function getUiLocale(code: string): UiLocale | undefined {
  return UI_LOCALES.find((locale) => locale.code === code);
}

export function isSupportedLocale(code: string): boolean {
  return UI_LOCALES.some((locale) => locale.code === code);
}

export function matchDeviceLocale(
  deviceLanguageCode: string | null | undefined,
  deviceScript?: string | null,
): string {
  const language = (deviceLanguageCode ?? FALLBACK_LOCALE).toLowerCase();
  const script = deviceScript?.toLowerCase();

  if (script) {
    const withScript = UI_LOCALES.find(
      (locale) =>
        locale.languageCode === language &&
        locale.script?.toLowerCase() === script,
    );
    if (withScript) {
      return withScript.code;
    }
  }

  const byLanguage = UI_LOCALES.find(
    (locale) => locale.languageCode === language && !locale.script,
  );
  if (byLanguage) {
    return byLanguage.code;
  }

  const anyLanguage = UI_LOCALES.find(
    (locale) => locale.languageCode === language,
  );
  return anyLanguage?.code ?? FALLBACK_LOCALE;
}

export function deviceLocale(): string {
  const device = getLocales()[0];
  return matchDeviceLocale(
    device?.languageCode ?? FALLBACK_LOCALE,
    device?.languageScriptCode,
  );
}

export function isLocalePreference(code: string): boolean {
  return code === SYSTEM_LOCALE || isSupportedLocale(code);
}

export function resolveLocalePreference(preference: string): string {
  if (preference === SYSTEM_LOCALE) {
    return deviceLocale();
  }
  return isSupportedLocale(preference) ? preference : FALLBACK_LOCALE;
}

export function fontFamilyForLocale(code: string): string | undefined {
  const family = getUiLocale(code)?.fontFamily;
  // iOS UIFont looks up PostScript names; `NotoSansGurmukhi` is only an Android alias
  // and falls back to Apple's blocky system Gurmukhi.
  if (Platform.OS === "ios" && family === "NotoSansGurmukhi") {
    return "NotoSansGurmukhi-Regular";
  }
  return family;
}

export function fontFamilyBoldForLocale(code: string): string | undefined {
  return getUiLocale(code)?.fontFamilyBold;
}
