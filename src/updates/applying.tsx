import { create } from "zustand";
import {
  ActivityIndicator,
  Animated,
  Appearance,
  Platform,
} from "react-native";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useChrome } from "@/hooks/use-chrome";
import {
  SPLASH_ANDROID_CORNER_RADIUS,
  SPLASH_IMAGE_WIDTH,
} from "@/splash/constants";
import {
  colorsFor,
  type ColorSchemeName,
} from "@/theme/colors";
import { useIsDark } from "@/theme/use-theme-colors";
import { Image, Text, View, cn } from "@/tw";

const splashLight = require("../../assets/icon-light.png");
const splashDark = require("../../assets/icon-dark.png");

const SPLASH_FADE_MS = 280;

type ApplyingState = {
  applying: boolean;
  setApplying: (applying: boolean) => void;
};

/** Lives outside the splash so Settings / busy-confirm can show the same spinner. */
export const useOtaApplyingStore = create<ApplyingState>((set) => ({
  applying: false,
  setApplying: (applying) => set({ applying }),
}));

function useFadePresence(visible: boolean, fadeIn: boolean): {
  opacity: Animated.Value;
  mounted: boolean;
} {
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [mounted, setMounted] = useState(visible);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const everShownRef = useRef(visible);

  useEffect(() => {
    if (visible) {
      everShownRef.current = true;
      setMounted(true);
      const anim = Animated.timing(opacity, {
        toValue: 1,
        duration: fadeIn ? SPLASH_FADE_MS : 0,
        useNativeDriver: true,
      });
      anim.start();
      return () => anim.stop();
    }
    if (!everShownRef.current) {
      return;
    }
    const anim = Animated.timing(opacity, {
      toValue: 0,
      duration: SPLASH_FADE_MS,
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished && !visibleRef.current) {
        setMounted(false);
      }
    });
    return () => anim.stop();
  }, [fadeIn, opacity, visible]);

  return { opacity, mounted };
}

function SplashChrome({
  message,
  overlay,
  scheme,
}: {
  message: string;
  overlay?: boolean;
  scheme: ColorSchemeName;
}) {
  const { t } = useTranslation();
  const { body, bodySmall, title } = useChrome();
  const splash = colorsFor(scheme);
  const appTitle = t("home.title");
  const logoRadius =
    Platform.OS === "android" ? SPLASH_ANDROID_CORNER_RADIUS : 0;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`${appTitle}. ${message}. ${t("ota.pleaseWait")}`}
      className={overlay ? "absolute inset-0 z-60" : "flex-1"}
      style={{ backgroundColor: splash.bg }}
    >
      {/* Native splash centers this image; keep it pinned so the loader cannot shift it. */}
      <View
        pointerEvents="none"
        className="absolute inset-0 items-center justify-center"
      >
        <View
          style={{
            width: SPLASH_IMAGE_WIDTH,
            height: SPLASH_IMAGE_WIDTH,
            borderRadius: logoRadius,
            overflow: "hidden",
          }}
        >
          <Image
            source={scheme === "dark" ? splashDark : splashLight}
            accessible={false}
            accessibilityIgnoresInvertColors
            contentFit="contain"
            style={{ width: SPLASH_IMAGE_WIDTH, height: SPLASH_IMAGE_WIDTH }}
          />
        </View>
      </View>
      {/* Sit above the pinned logo; a column stack would jump the icon off the native splash center. */}
      <View
        pointerEvents="none"
        className="absolute inset-x-0 items-center px-8"
        style={{
          bottom: "50%",
          marginBottom: SPLASH_IMAGE_WIDTH / 2 + 20,
        }}
      >
        <Text
          className={cn("text-center", title)}
          style={{ color: splash.text }}
        >
          {appTitle}
        </Text>
      </View>
      <View
        className="absolute inset-x-0 items-center gap-4 px-8"
        style={{
          top: "50%",
          marginTop: SPLASH_IMAGE_WIDTH / 2 + 16,
        }}
      >
        <ActivityIndicator size="large" color={splash.accent} />
        <View className="items-center gap-1">
          <Text
            className={cn("text-center", body)}
            style={{ color: splash.text }}
          >
            {message}
          </Text>
          <Text
            className={cn("text-center", bodySmall)}
            style={{ color: splash.textMuted }}
          >
            {t("ota.pleaseWait")}
          </Text>
        </View>
      </View>
    </View>
  );
}

/**
 * Replaces the native splash once JS can paint. `reloadAsync` still tears this
 * down — it only covers hydrate / check, not the native blank after reload.
 * `hold` stays true until the app tree is under this layer, then we fade out.
 */
export function JsSplash({
  hold,
  onHidden,
}: {
  hold: boolean;
  onHidden: () => void;
}) {
  const { t } = useTranslation();
  const applying = useOtaApplyingStore((state) => state.applying);
  // Native splash follows OS appearance; freeze that so a Settings theme cannot swap the logo mid-gate.
  const [handoffScheme] = useState<ColorSchemeName>(() =>
    Appearance.getColorScheme() === "dark" ? "dark" : "light",
  );
  const { opacity, mounted } = useFadePresence(hold, false);
  const hiddenRef = useRef(false);
  const onHiddenRef = useRef(onHidden);
  onHiddenRef.current = onHidden;

  useEffect(() => {
    if (hold || mounted || hiddenRef.current) {
      return;
    }
    hiddenRef.current = true;
    onHiddenRef.current();
  }, [hold, mounted]);

  if (!mounted) {
    return null;
  }

  return (
    <Animated.View
      pointerEvents={hold ? "auto" : "none"}
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 50,
        opacity,
      }}
    >
      <SplashChrome
        scheme={handoffScheme}
        message={applying ? t("ota.applying") : t("ota.loading")}
      />
    </Animated.View>
  );
}

/** Same chrome after first paint (Settings / busy confirm). Dies on reload. */
export function OtaApplyingOverlay() {
  const { t } = useTranslation();
  const applying = useOtaApplyingStore((state) => state.applying);
  const isDark = useIsDark();
  const { opacity, mounted } = useFadePresence(applying, true);
  if (!mounted) {
    return null;
  }
  return (
    <Animated.View
      pointerEvents={applying ? "auto" : "none"}
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 60,
        opacity,
      }}
    >
      <SplashChrome
        overlay
        scheme={isDark ? "dark" : "light"}
        message={t("ota.applying")}
      />
    </Animated.View>
  );
}
