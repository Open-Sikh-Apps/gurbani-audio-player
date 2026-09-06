import { Stack } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { IconButton } from "@/components/icon-button";
import { OverflowMenu } from "@/components/overflow-menu";
import { useChrome } from "@/hooks/use-chrome";
import {
  armSleepAlbum,
  armSleepDuration,
  armSleepTrack,
  armSleepTracks,
  cancelSleepTimer,
  formatDuration,
  usePlaybackStore,
  useSleepTimerStore,
} from "@/playback";
import { useThemeColors } from "@/theme/use-theme-colors";
import { Pressable, ScrollView, Text, View, cn, ui } from "@/tw";
import { HeaderCloseButton } from "@/components/header-close-button";

function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
}) {
  const { hit, text, playerIcon } = useChrome();
  const colors = useThemeColors();
  const atMin = value <= min;
  const atMax = max != null && value >= max;
  return (
    <View className="items-center gap-2">
      <Text className={cn(ui.muted, text)}>{label}</Text>
      <View className="flex-row items-center gap-4">
        <IconButton
          name="remove"
          accessibilityLabel={`${label} −`}
          size={playerIcon}
          color={colors.accent}
          className={hit}
          disabled={atMin}
          onPress={() => onChange(Math.max(min, value - 1))}
        />
        <Text className={cn("min-w-12 text-center font-semibold", ui.text, text)}>
          {value}
        </Text>
        <IconButton
          name="add"
          accessibilityLabel={`${label} +`}
          size={playerIcon}
          color={colors.accent}
          className={hit}
          disabled={atMax}
          onPress={() => onChange(max == null ? value + 1 : Math.min(max, value + 1))}
        />
      </View>
    </View>
  );
}

function SleepRemaining() {
  const { t } = useTranslation();
  const { text, title, body } = useChrome();
  const kind = useSleepTimerStore((state) => state.kind);
  const remainingSec = useSleepTimerStore((state) => state.remainingSec);
  const remainingTrackEnds = useSleepTimerStore((state) => state.remainingTrackEnds);
  return (
    <>
      <Text className={cn("text-center", ui.muted, body)}>{t("sleep.remaining")}</Text>
      <Text className={cn("text-center font-semibold", ui.text, title)}>
        {kind === "tracks"
          ? t("sleep.tracksRemaining", {
              count: Math.max(1, remainingTrackEnds),
            })
          : formatDuration(remainingSec)}
      </Text>
      {kind === "tracks" && remainingTrackEnds === 1 ? (
        <Text className={cn("text-center", ui.muted, text)}>
          {formatDuration(remainingSec)}
        </Text>
      ) : null}
    </>
  );
}

export function SleepTimerScreen() {
  const { t } = useTranslation();
  const { hit, text } = useChrome();
  const session = usePlaybackStore((state) => state.session);
  const currentIndex = usePlaybackStore((state) => state.currentIndex);
  const kind = useSleepTimerStore((state) => state.kind);
  const trackCount = session?.tracks.length ?? 0;
  const tracksLeft = Math.max(1, trackCount - Math.max(0, currentIndex));
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(15);
  const [trackEnds, setTrackEnds] = useState(Math.min(2, tracksLeft));
  const hasTracks = trackCount > 0;
  const armed = kind !== "off";

  return (
    <>
      <Stack.Screen
        options={{
          title: t("sleep.title"),
          headerRight: () => <OverflowMenu />,
          headerLeft: () => <HeaderCloseButton />,
        }}
      />
      <ScrollView
        className={cn("flex-1", ui.page)}
        contentContainerClassName="gap-4 px-6 py-6"
      >
        {armed ? (
          <View className="gap-3 py-4">
            <SleepRemaining />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("sleep.cancel")}
              className={cn(
                "mt-2 justify-center rounded-2xl border px-4",
                ui.borderAccent,
                ui.surface,
                hit,
              )}
              onPress={cancelSleepTimer}
            >
              <Text className={cn("text-center", ui.accent, text)}>{t("sleep.cancel")}</Text>
            </Pressable>
          </View>
        ) : null}

        {hasTracks ? (
          <>
            <Pressable
              accessibilityRole="button"
              className={cn(
                "items-center justify-center rounded-2xl border px-4",
                ui.border,
                ui.surface,
                hit,
              )}
              onPress={armSleepTrack}
            >
              <Text className={cn(ui.text, text)}>{t("sleep.endOfTrack")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              className={cn(
                "items-center justify-center rounded-2xl border px-4",
                ui.border,
                ui.surface,
                hit,
              )}
              onPress={armSleepAlbum}
            >
              <Text className={cn(ui.text, text)}>{t("sleep.endOfAlbum")}</Text>
            </Pressable>
            <View className={cn("gap-4 rounded-2xl border p-4", ui.border, ui.surface)}>
              <Text className={cn(ui.text, text)}>{t("sleep.afterTracks")}</Text>
              <Stepper
                label={t("sleep.tracks")}
                value={trackEnds}
                min={1}
                max={tracksLeft}
                onChange={setTrackEnds}
              />
              <Pressable
                accessibilityRole="button"
                className={cn(
                  "items-center justify-center rounded-2xl border px-4",
                  ui.borderAccent,
                  hit,
                )}
                onPress={() => armSleepTracks(Math.min(trackEnds, tracksLeft))}
              >
                <Text className={cn(ui.accent, text)}>{t("sleep.start")}</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        <View className={cn("gap-4 rounded-2xl border p-4", ui.border, ui.surface)}>
          <Text className={cn(ui.text, text)}>{t("sleep.duration")}</Text>
          <View className="flex-row gap-8">
            <View className="flex-1">
              <Stepper label={t("sleep.hours")} value={hours} onChange={setHours} />
            </View>
            <View className="flex-1">
              <Stepper
                label={t("sleep.minutes")}
                value={minutes}
                onChange={setMinutes}
              />
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: hours === 0 && minutes === 0 }}
            className={cn(
              "items-center justify-center rounded-2xl border px-4",
              ui.borderAccent,
              hit,
              hours === 0 && minutes === 0 && "opacity-40",
            )}
            disabled={hours === 0 && minutes === 0}
            onPress={() => armSleepDuration(hours, minutes)}
          >
            <Text className={cn(ui.accent, text)}>{t("sleep.start")}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </>
  );
}
