import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";

import {
  getCollectionById,
  getReciterById,
  getScriptureById,
  getTrackInCollection,
  resolveL10n,
  useCatalogueStore,
} from "@/catalogue";
import { fileKey, playableUrlFor, useDownloadStore, useIsOnline } from "@/downloads";
import { AppIcon } from "@/components/app-icon";
import { HeaderCloseButton } from "@/components/header-close-button";
import { OverflowMenu } from "@/components/overflow-menu";
import { useChrome } from "@/hooks/use-chrome";
import { useDebouncedNavigation } from "@/hooks/use-debounced-navigation";
import { LIST_PLAY_PRESS_DELAY_MS } from "@/hooks/list-play-press";
import { useResolvedLocale } from "@/hooks/use-resolved-locale";
import {
  formatDuration,
  getAlbumResume,
  midTrackResumeSec,
  playAlbum,
  sessionFromCollection,
  usePlaybackStore,
  useResumeStore,
} from "@/playback";
import { useHistoryStore, type HistoryEntry } from "@/state/history-store";
import { FlashList, Pressable, Text, View, cn, ui } from "@/tw";
import { useThemeColors } from "@/theme/use-theme-colors";

function formatPlayedAt(playedAt: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(playedAt));
}

function resumePositionSec(
  albumId: string,
  trackId: string,
  durationSec: number | undefined,
): number | null {
  const resume = getAlbumResume(albumId);
  if (!resume || resume.trackId !== trackId) {
    return null;
  }
  return midTrackResumeSec(
    resume.positionSec,
    resume.durationSec ?? durationSec,
  );
}

function HistoryRow({
  item,
}: {
  item: HistoryEntry;
}) {
  const { t } = useTranslation();
  const { text, hit, title, tabIcon } = useChrome();
  const locale = useResolvedLocale();
  const colors = useThemeColors();
  const { navigate } = useDebouncedNavigation();
  const catalogue = useCatalogueStore((state) => state.catalogue);
  const collection = getCollectionById(catalogue, item.albumId);
  const track = getTrackInCollection(catalogue, item.albumId, item.trackId);
  const heading = track
    ? resolveL10n(track.title, locale)
    : t("bookmark.unavailable");
  const subtitle = (() => {
    if (!collection) {
      return { fallback: t("album.unavailable") as string | undefined };
    }
    if (collection.kind === "sehaj_paath") {
      const reciter = getReciterById(catalogue, collection.reciterId);
      const scripture = getScriptureById(catalogue, collection.scriptureId);
      return {
        reciter: reciter ? resolveL10n(reciter.name, locale) : undefined,
        scripture: scripture ? resolveL10n(scripture.name, locale) : undefined,
        fallback: undefined as string | undefined,
      };
    }
    return {
      reciter: undefined as string | undefined,
      scripture: undefined as string | undefined,
      fallback: collection.title
        ? resolveL10n(collection.title, locale)
        : t(`collection.${collection.kind}`),
    };
  })();
  const subtitleLabel =
    [collection ? t(`collection.${collection?.kind}`) : null, subtitle.scripture, subtitle.reciter].filter(Boolean).join(" · ") ||
    subtitle.fallback ||
    "";
  const when = formatPlayedAt(item.playedAt, locale);
  const durationSec =
    track && "durationSec" in track ? track.durationSec : undefined;
  const online = useIsOnline();
  const downloaded = useDownloadStore((state) =>
    track != null
      ? state.files[fileKey(track.id, track.url)]?.status === "completed"
      : false,
  );
  const liveNow = usePlaybackStore((state) =>
    state.session?.albumId === item.albumId &&
    state.currentTrackId === item.trackId &&
    (state.playing || state.buffering),
  );
  // Live playback is already in the player — keep the row tappable so offline users can open Now Playing.
  const muted = !online && !downloaded && !liveNow;
  const resumeAt = useResumeStore((state) => {
    if (liveNow) {
      return null;
    }
    const resume = state.positions[item.albumId];
    if (!resume || resume.trackId !== item.trackId) {
      return null;
    }
    return midTrackResumeSec(
      resume.positionSec,
      resume.durationSec ?? durationSec,
    );
  });
  const statusLabel = liveNow
    ? t("album.playing")
    : resumeAt != null
      ? t("history.resumeFrom", { time: formatDuration(resumeAt) })
      : null;

  async function playEntry(): Promise<void> {
    const live = usePlaybackStore.getState();
    const liveNowPress =
      live.session?.albumId === item.albumId &&
      live.currentTrackId === item.trackId &&
      (live.playing || live.buffering);
    // Don't rebuild the queue from catalogue while this row is already playing.
    if (liveNowPress) {
      navigate("/now-playing");
      return;
    }
    if (!collection || !track) {
      Alert.alert(t("bookmark.unavailable"));
      return;
    }
    const reciter = collection.reciterId
      ? getReciterById(catalogue, collection.reciterId)
      : undefined;
    const scripture = collection.scriptureId
      ? getScriptureById(catalogue, collection.scriptureId)
      : undefined;
    const at = resumePositionSec(
      item.albumId,
      item.trackId,
      durationSec,
    );
    if (
      !online &&
      playableUrlFor(track.id, track.url) == null
    ) {
      return;
    }
    const started = await playAlbum(
      sessionFromCollection(collection, reciter, scripture),
      {
        trackId: item.trackId,
        positionSec: at ?? 0,
      },
    );
    if (started) {
      navigate("/now-playing");
    }
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${heading}. ${subtitleLabel}. ${when}${statusLabel ? `. ${statusLabel}` : ""}`}
      accessibilityState={{ disabled: muted }}
      className={cn(
        "mb-4 rounded-2xl border px-4 py-4",
        ui.border,
        ui.surface,
        hit,
        muted && "opacity-40",
      )}
      disabled={muted}
      onPress={() => {
        void playEntry();
      }}
      unstable_pressDelay={LIST_PLAY_PRESS_DELAY_MS}
    >
      <View className="flex-row items-center gap-2">
        <Text className={cn("min-w-0 flex-1 font-semibold", ui.text, title)}>
          {heading}
        </Text>
        {downloaded ? (
          <AppIcon name="download-done" size={tabIcon} color={colors.accent} />
        ) : null}
      </View>
      {subtitleLabel ? (
        <View className="flex-row flex-wrap">
          {subtitleLabel.split(" · ").map((part, index, array) => (
            <Text key={index} className={cn(text, ui.text, "shrink-0 max-w-full")}>
              {`${part}${index < array.length - 1 ? " · " : ""}`}
            </Text>
          ))}
        </View>
      ) : null}
      <Text className={cn("mt-1", ui.muted, text)}>{when}</Text>
      {statusLabel ? (
        <Text className={cn("mt-1", ui.muted, text)}>{statusLabel}</Text>
      ) : null}
    </Pressable>
  );
}

export function HistoryScreen() {
  const { t } = useTranslation();
  const { body } = useChrome();
  const items = useHistoryStore((state) => state.items);

  return (
    <>
      <Stack.Screen
        options={{
          title: t("history.title"),
          headerBackVisible: false,
          headerLeft: () => <HeaderCloseButton />,
          headerRight: () => <OverflowMenu />,
        }}
      />
      {items.length === 0 ? (
        <View className={cn("flex-1 items-center justify-center px-6", ui.page)}>
          <Text className={cn("text-center", ui.muted, body)}>
            {t("history.empty")}
          </Text>
        </View>
      ) : (
        <View className={cn("flex-1", ui.page)}>
          <FlashList
            data={items}
            // Same track can appear twice; index keeps keys unique.
            keyExtractor={(item, index) =>
              `${item.playedAt}:${item.albumId}:${item.trackId}:${index}`
            }
            contentContainerClassName="px-6 py-6"
            renderItem={({ item, index }) => (
              // Newest-first: only the top row may resume mid-track
              <HistoryRow item={item} />
            )}
          />
        </View>
      )}
    </>
  );
}
