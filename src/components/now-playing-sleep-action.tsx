import { useTranslation } from "react-i18next";

import { NowPlayingAction } from "@/components/now-playing-action";
import { useDebouncedNavigation } from "@/hooks/use-debounced-navigation";
import { formatDuration, useSleepTimerStore } from "@/playback";

// Own remainingSec so Now Playing art/transport do not re-render on sleep ticks.
export function NowPlayingSleepAction() {
  const { t } = useTranslation();
  const { navigate } = useDebouncedNavigation();
  const sleepKind = useSleepTimerStore((state) => state.kind);
  const remainingSec = useSleepTimerStore((state) => state.remainingSec);
  const remainingTrackEnds = useSleepTimerStore((state) => state.remainingTrackEnds);

  return (
    <NowPlayingAction
      name={sleepKind === "off" ? "bedtime" : "nights-stay"}
      accessibilityLabel={
        sleepKind === "off"
          ? t("sleep.title")
          : `${t("sleep.title")}. ${t("sleep.remaining")}`
      }
      label={
        sleepKind === "off"
          ? t("sleep.title")
          : sleepKind === "tracks"
            ? t("sleep.tracksRemaining", { count: remainingTrackEnds })
            : formatDuration(remainingSec)
      }
      selected={sleepKind !== "off"}
      filled={sleepKind !== "off"}
      onPress={() => navigate("/now-playing/sleep-timer")}
    />
  );
}
