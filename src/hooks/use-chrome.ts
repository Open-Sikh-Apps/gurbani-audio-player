import { useWindowDimensions } from "react-native";

import { usePreferencesStore } from "@/state/preferences-store";

export function useSimpleMode() {
  return usePreferencesStore((state) => state.simpleMode);
}

/** iPad / Android tablet compact width. Phone-sized windows keep the original pair. */
const TABLET_MIN_WIDTH = 768;

const PHONE_REGULAR = {
  hit: "min-h-14",
  text: "text-lg",
  title: "text-2xl font-semibold",
  subtitle: "text-xl",
  body: "text-lg",
  bodySmall: "text-base",
  nowPlayingActionText: "text-xs",
  tabIcon: 26,
  playerIcon: 32,
  playerPlayIcon: 56,
  scrubberTrack: "h-1.5",
  scrubberThumb: 16,
} as const;

const PHONE_SIMPLE = {
  hit: "min-h-16",
  text: "text-xl",
  title: "text-3xl font-semibold",
  subtitle: "text-2xl",
  body: "text-xl",
  bodySmall: "text-lg",
  nowPlayingActionText: "text-xs font-semibold",
  tabIcon: 32,
  playerIcon: 40,
  playerPlayIcon: 68,
  scrubberTrack: "h-4",
  scrubberThumb: 28,
} as const;

const TABLET_SIMPLE = {
  hit: "min-h-20",
  text: "text-2xl",
  title: "text-4xl font-semibold",
  subtitle: "text-3xl",
  body: "text-2xl",
  bodySmall: "text-xl",
  nowPlayingActionText: "text-lg font-semibold",
  tabIcon: 40,
  playerIcon: 48,
  playerPlayIcon: 80,
  scrubberTrack: "h-5",
  scrubberThumb: 32,
} as const;

export function useChrome() {
  const simpleMode = useSimpleMode();
  const { width } = useWindowDimensions();
  const tablet = width >= TABLET_MIN_WIDTH;
  // Hit/text are NativeWind; icon sizes are dp because vector icons ignore className.
  // Tablet regular uses the phone Simple-mode scale; tablet Simple is a step larger.
  const tokens = tablet
    ? simpleMode
      ? TABLET_SIMPLE
      : PHONE_SIMPLE
    : simpleMode
      ? PHONE_SIMPLE
      : PHONE_REGULAR;
  return {
    simpleMode,
    ...tokens,
  } as const;
}
