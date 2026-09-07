import { ExpoConfig, ConfigContext } from "expo/config";
// Expo loads this as CJS; tsx lets it import TypeScript modules.
import "tsx/cjs";

import { shouldUseMockCatalogue } from "./src/catalogue/mock-catalogue-flag";
import { SPLASH_IMAGE_WIDTH } from "./src/splash/constants";
import { palette } from "./src/theme/colors";

export default ({ config }: ConfigContext): ExpoConfig => {
  const easProfile = process.env.EAS_BUILD_PROFILE;
  // Self-hosted OTA folder is baked into the binary. Preview APKs stay on
  // `preview`; only the Play AAB (`eas.json` production) uses `production`.
  const otaChannel = easProfile === "production" ? "production" : "preview";

  if (easProfile === "preview" || easProfile === "production") {
    if (shouldUseMockCatalogue()) {
      throw new Error(
        `EAS profile "${easProfile}" cannot set EXPO_PUBLIC_USE_MOCK_CATALOGUE. Unset it so the binary fetches Pages.`,
      );
    }
    if (
      !process.env.EXPO_PUBLIC_CATALOGUE_BASE_URL?.trim() ||
      !process.env.EXPO_PUBLIC_MEDIA_BASE_URL?.trim()
    ) {
      throw new Error(
        `EAS profile "${easProfile}" needs EXPO_PUBLIC_CATALOGUE_BASE_URL and EXPO_PUBLIC_MEDIA_BASE_URL (eas.json env).`,
      );
    }
  }

  return {
    // Spread app.json so EAS/plugins can mutate the object; this file only fills name/slug fallbacks.
    ...config,
    icon: "./assets/icon-light.png",
    name: process.env.APP_VARIANT === "development" ? "Gurbani audio player (dev)" : config.name ?? "Gurbani audio player",
    slug: config.slug ?? "gurbani-audio-player",
    scheme: process.env.APP_VARIANT === "development" ? "gurbaniaudioplayer-dev" : config.scheme ?? "gurbaniaudioplayer",
    updates: {
      ...config.updates,
      requestHeaders: {
        ...config.updates?.requestHeaders,
        "expo-channel-name": otaChannel,
      },
    },
    plugins: (config.plugins ?? []).map((plugin) => {
      if (Array.isArray(plugin) && plugin[0] === "expo-splash-screen") {
        return [
          "expo-splash-screen",
          {
            image: "./assets/icon-light.png",
            backgroundColor: palette.light.bg,
            imageWidth: SPLASH_IMAGE_WIDTH,
            dark: {
              image: "./assets/icon-dark.png",
              backgroundColor: palette.dark.bg,
            },
          },
        ];
      }
      return plugin;
    }),
    android: {
      ...config.android,
      package: process.env.APP_VARIANT === "development" ? "com.opensikhapps.gurbaniaudioplayer.dev" : config.android?.package ?? "com.opensikhapps.gurbaniaudioplayer",
      googleServicesFile: process.env.APP_VARIANT === "development" ? "./google-services-dev.json" : config.android?.googleServicesFile ?? "./google-services.json",
      // Foreground is inset to the 66% adaptive safe zone so the launcher mask does not crop the art.
      adaptiveIcon: {
        foregroundImage: "./assets/android-icon-foreground.png",
        backgroundColor: palette.light.bg,
      },
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: [
            {
              scheme: "https",
              host: process.env.APP_VARIANT === "development" ? "gurbaniaudioplayer-dev.opensikhapps.com" : "gurbaniaudioplayer.opensikhapps.com",
              pathPrefix: "/a",
            },
          ],
          category: ["BROWSABLE", "DEFAULT"],
        },
      ],
    },
    ios: {
      ...config.ios,
      icon: {
        light: "./assets/icon-light.png",
        dark: "./assets/icon-dark.png",
      },
      bundleIdentifier: process.env.APP_VARIANT === "development" ? "com.opensikhapps.gurbaniaudioplayer.dev" : config.ios?.bundleIdentifier ?? "com.opensikhapps.gurbaniaudioplayer",
      googleServicesFile: process.env.APP_VARIANT === "development" ? "./GoogleService-Info-dev.plist" : config.ios?.googleServicesFile ?? "./GoogleService-Info.plist",
      usesIcloudStorage: false,
      // associatedDomains: process.env.APP_VARIANT === "development" ? ["applinks:gurbaniaudioplayer-dev.opensikhapps.com"] : config.ios?.associatedDomains ?? [
      //   "applinks:gurbaniaudioplayer.opensikhapps.com",
      // ],
    },
  };
};
