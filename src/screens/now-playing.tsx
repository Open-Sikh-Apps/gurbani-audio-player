import * as Linking from "expo-linking";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";

import { AppIcon } from "@/components/app-icon";
import { CatalogueImage } from "@/components/catalogue-image";
import { IconButton } from "@/components/icon-button";
import { NowPlayingAction } from "@/components/now-playing-action";
import { NowPlayingAlbumButton } from "@/components/now-playing-album-button";
import { PlaybackScrubber } from "@/components/playback-scrubber";
import { PlaybackStatusLine } from "@/components/playback-status-line";
import {
  getScriptureById,
  resolveL10n,
  useCatalogueStore,
} from "@/catalogue";
import { playableUrlFor, useIsOnline } from "@/downloads";
import { useChrome } from "@/hooks/use-chrome";
import { useDebouncedNavigation } from "@/hooks/use-debounced-navigation";
import { useResolvedLocale } from "@/hooks/use-resolved-locale";
import {
  PLAYBACK_RATE_MAX,
  PLAYBACK_RATE_MIN,
  PLAYBACK_RATE_STEP,
  clampPlaybackRate,
  formatDuration,
  getSessionTrack,
  isLocalPlaybackUrl,
  seekBy,
  seekTo,
  setPlaybackRate,
  skipNext,
  skipPrevious,
  togglePlayPause,
  usePlaybackStore,
  useSleepTimerStore,
} from "@/playback";
import { useThemeColors } from "@/theme/use-theme-colors";
import { Text, View, cn, ui } from "@/tw";

// In-app ±10s is fixed; lock-screen/headset skip vs seek is Settings remotePrimary.
const SEEK_SEC = 10;

function formatRate(rate: number): string {
  return `${parseFloat(rate.toFixed(2))}×`;
}

// Own the position subscription so transport/art do not re-render on every progress tick.
function LivePlaybackScrubber() {
  const positionSec = usePlaybackStore((state) => state.positionSec);
  const durationSec = usePlaybackStore((state) => state.durationSec);
  return (
    <PlaybackScrubber
      positionSec={positionSec}
      durationSec={durationSec}
      onSeek={seekTo}
    />
  );
}

export function NowPlayingScreen() {
  const { t } = useTranslation();
  const locale = useResolvedLocale();
  const { text, hit, title, playerIcon, playerPlayIcon, simpleMode, tabIcon } =
    useChrome();
  const colors = useThemeColors();
  const session = usePlaybackStore((state) => state.session);
  const playing = usePlaybackStore((state) => state.playing);
  const currentTrackId = usePlaybackStore((state) => state.currentTrackId);
  const currentIndex = usePlaybackStore((state) => state.currentIndex);
  const rate = usePlaybackStore((state) => state.rate);
  const albumEnded = usePlaybackStore((state) => state.albumEnded);
  const { navigate } = useDebouncedNavigation();
  const catalogue = useCatalogueStore((state) => state.catalogue);
  const sleepKind = useSleepTimerStore((state) => state.kind);
  const remainingSec = useSleepTimerStore((state) => state.remainingSec);
  const remainingTrackEnds = useSleepTimerStore((state) => state.remainingTrackEnds);
  const online = useIsOnline();

  if (!session) {
    return (
      <View className={cn("flex-1 items-center justify-center px-6", ui.page)}>
        <Text className={cn("text-center", ui.muted, text)}>
          {t("nowPlaying.placeholder")}
        </Text>
      </View>
    );
  }

  const track = getSessionTrack(session, currentTrackId);
  const reciter = resolveL10n(session.reciterName, locale);
  const heading = track ? resolveL10n(track.title, locale) : reciter;
  const fromDisk = track != null && isLocalPlaybackUrl(track.url);
  const fileReady =
    track != null && playableUrlFor(track.id, track.remoteUrl) != null;
  // Streams stay disabled while offline; a finished download is playable even
  // if the frozen URL is still https until pause unpins it.
  const playBlocked = !playing && !online && !fromDisk && !fileReady;
  const isLast = currentIndex >= session.tracks.length - 1;
  const atMinRate = rate <= PLAYBACK_RATE_MIN;
  const atMaxRate = rate >= PLAYBACK_RATE_MAX;
  const scripture = session.scriptureId
    ? getScriptureById(catalogue, session.scriptureId)
    : undefined;
  // Hide when this track has no ang or this scripture has no STTM slug.
  const showReadAlong = track?.startAng != null && scripture?.sttmCoSlug != null;

  const scriptureName = scripture
    ? resolveL10n(scripture.name, locale)
    : null;
  const kindLabel = session.collectionKind
    ? t(`collection.${session.collectionKind}`)
    : null;
  const showScriptureArt =
    session.collectionKind === "sehaj_paath" && scripture?.imageUrl != null;
  const playName = playing
    ? "pause-circle"
    : albumEnded
      ? "replay"
      : "play-circle";
  const playLabel = playing
    ? t("player.pause")
    : albumEnded
      ? t("player.restart")
      : t("player.play");

  return (
    <View
      className={cn(
        "flex-1",
        ui.page,
        simpleMode ? "px-5 py-2" : "px-6 py-3",
      )}
    >
      {/* Art eats leftover height so the transport stays pinned to the bottom. */}
      <View
        className={cn(
          "gap-2",
          showScriptureArt ? "min-h-0 flex-1" : "shrink-0",
        )}
      >
        {showScriptureArt ? (
          <CatalogueImage
            uri={scripture?.imageUrl}
            className="min-h-28 flex-1"
            accessibilityLabel={scriptureName ?? reciter}
          />
        ) : null}
        {kindLabel || scriptureName ? (
          <View className="flex-row flex-wrap">
            {kindLabel ? (
              <Text className={cn(text, ui.text, "shrink-0 max-w-full")}>
                {kindLabel + " · "}
              </Text>
            ) : null}
            {scriptureName ? (
              <Text className={cn(text, ui.text, "shrink-0 max-w-full")}>
                {scriptureName}
              </Text>
            ) : null}
          </View>
        ) : null}
        <Text className={cn(ui.muted, text)} numberOfLines={1}>
          {reciter}
        </Text>
        <View className="flex-row items-center gap-2">
          <Text className={cn("min-w-0 flex-1", ui.text, title)} numberOfLines={2}>
            {heading}
          </Text>
          {fromDisk ? (
            <AppIcon
              name="download-done"
              size={tabIcon}
              color={colors.accent}
            />
          ) : null}
        </View>
        {/* Reserved height so an error line does not jump the controls. */}
        <PlaybackStatusLine className={simpleMode ? "min-h-10" : "min-h-12"} />
      </View>

      <View className={cn("shrink-0", simpleMode ? "gap-3" : "gap-4")}>
        <LivePlaybackScrubber />

        <View className="flex-row items-center justify-between">
          <IconButton
            name="skip-previous"
            accessibilityLabel={t("player.previous")}
            size={playerIcon}
            color={colors.accent}
            className={hit}
            onPress={skipPrevious}
          />
          <IconButton
            name="replay-10"
            accessibilityLabel={t("player.seekBack")}
            size={playerIcon}
            color={colors.accent}
            className={hit}
            onPress={() => seekBy(-SEEK_SEC)}
          />
          <IconButton
            name={playName}
            accessibilityLabel={playLabel}
            size={playerPlayIcon}
            color={colors.accent}
            className={hit}
            disabled={playBlocked}
            onPress={togglePlayPause}
          />
          <IconButton
            name="forward-10"
            accessibilityLabel={t("player.seekForward")}
            size={playerIcon}
            color={colors.accent}
            className={hit}
            onPress={() => seekBy(SEEK_SEC)}
          />
          <IconButton
            name="skip-next"
            accessibilityLabel={t("player.next")}
            size={playerIcon}
            color={colors.accent}
            className={hit}
            disabled={isLast}
            onPress={skipNext}
          />
        </View>

        <View className="flex-row items-center justify-center gap-6">
          <IconButton
            name="remove"
            accessibilityLabel={t("player.rateSlower")}
            size={playerIcon}
            color={colors.accent}
            className={hit}
            disabled={atMinRate}
            onPress={() => setPlaybackRate(clampPlaybackRate(rate - PLAYBACK_RATE_STEP))}
          />
          <Text className={cn("min-w-16 text-center font-semibold", ui.text, text)}>
            {formatRate(rate)}
          </Text>
          <IconButton
            name="add"
            accessibilityLabel={t("player.rateFaster")}
            size={playerIcon}
            color={colors.accent}
            className={hit}
            disabled={atMaxRate}
            onPress={() => setPlaybackRate(clampPlaybackRate(rate + PLAYBACK_RATE_STEP))}
          />
        </View>

        <View className="flex-row items-start justify-between">
          <NowPlayingAlbumButton />
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
          <NowPlayingAction
            name="bookmark-border"
            accessibilityLabel={t("bookmark.add")}
            label={t("bookmark.add")}
            onPress={() => {
              if (!currentTrackId) {
                return;
              }
              // Stamp the position at tap; the note screen must not follow the live tick.
              const stamped = usePlaybackStore.getState().positionSec;
              navigate(
                `/now-playing/bookmark-note?albumId=${encodeURIComponent(session.albumId)}&trackId=${encodeURIComponent(currentTrackId)}&positionSec=${stamped}`,
              );
            }}
          />
          <NowPlayingAction
            name="bookmarks"
            accessibilityLabel={t("bookmark.listTitle")}
            label={t("bookmark.listTitle")}
            onPress={() => navigate("/now-playing/bookmarks")}
          />
          {showReadAlong ? (
            <NowPlayingAction
              name="menu-book"
              accessibilityLabel={t("player.readAlong")}
              label={t("player.readAlong")}
              disabled={!online}
              onPress={() => {
                if (!online) {
                  return;
                }
                const slug = scripture?.sttmCoSlug;
                const startAng = track?.startAng;
                if (slug == null || startAng == null) {
                  return;
                }
                // Confirm before leaving the app; STTM is a website, not in-app Gurbani.
                Alert.alert(t("player.readAlongTitle"), t("player.readAlongBody"), [
                  { text: t("player.readAlongCancel"), style: "cancel" },
                  {
                    text: t("player.readAlongOpen"),
                    onPress: () => {
                      void Linking.openURL(`https://sttm.co/${slug}/${startAng}`);
                    },
                  },
                ]);
              }}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}
