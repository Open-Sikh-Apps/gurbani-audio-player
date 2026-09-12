import { useTranslation } from "react-i18next";

import { resolveL10n } from "@/catalogue";
import { AppIcon } from "@/components/app-icon";
import { IconButton } from "@/components/icon-button";
import { useChrome } from "@/hooks/use-chrome";
import { useResolvedLocale } from "@/hooks/use-resolved-locale";
import { isLocalPlaybackUrl, getSessionTrack, togglePlayPause, usePlaybackStore } from "@/playback";
import { playableUrlFor, useIsOnline } from "@/downloads";
import { useThemeColors } from "@/theme/use-theme-colors";
import { Pressable, Text, View, cn, ui } from "@/tw";
import { useDebouncedNavigation } from "@/hooks/use-debounced-navigation";

export function MiniPlayer() {
  const { t } = useTranslation();
  const { text, hit, tabIcon } = useChrome();
  const locale = useResolvedLocale();
  const colors = useThemeColors();
  const session = usePlaybackStore((state) => state.session);
  const playing = usePlaybackStore((state) => state.playing);
  const currentTrackId = usePlaybackStore((state) => state.currentTrackId);
  const albumEnded = usePlaybackStore((state) => state.albumEnded);
  const error = usePlaybackStore((state) => state.error);
  const buffering = usePlaybackStore((state) => state.buffering);
  const { navigate } = useDebouncedNavigation();
  const online = useIsOnline();

  if (!session) {
    return null;
  }

  const track = getSessionTrack(session, currentTrackId);
  const fromDisk = track != null && isLocalPlaybackUrl(track.url);
  const fileReady =
    track != null && playableUrlFor(track.id, track.remoteUrl) != null;
  // Match Now Playing — a finished download is playable offline even if url is still https until pause unpins it.
  const playBlocked = !playing && !online && !fromDisk && !fileReady;
  const label = track
    ? resolveL10n(track.title, locale)
    : resolveL10n(session.reciterName, locale);
  const statusHint = error ?? (buffering ? t("player.buffering") : null);

  return (
    <View className={cn("flex-row items-center border-b px-3 py-1", ui.border)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          statusHint ? `${t("miniPlayer.open")}. ${statusHint}` : t("miniPlayer.open")
        }
        className={cn("min-w-0 flex-1 justify-center px-1", hit)}
        onPress={() => navigate("/now-playing")}
      >
        <View className="flex-row items-center gap-2">
          <Text className={cn("min-w-0 flex-1", ui.text, text)} numberOfLines={1}>
            {label}
          </Text>
          {error ? (
            <AppIcon
              name="error-outline"
              size={tabIcon}
              color={colors.accent}
            />
          ) : null}
          {fromDisk ? (
            <AppIcon
              name="download-done"
              size={tabIcon}
              color={colors.accent}
            />
          ) : null}
        </View>
        {track ? <Text className={cn(ui.muted, text)} numberOfLines={1}>
          {resolveL10n(session.reciterName, locale)}
        </Text> : null}
      </Pressable>
      <IconButton
        name={buffering ? "hourglass-empty" : playing ? "pause" : albumEnded ? "replay" : "play-arrow"}
        accessibilityLabel={
          buffering ? t("player.buffering") :
            playing
              ? t("player.pause")
              : albumEnded
                ? t("player.restart")
                : t("player.play")
        }
        size={tabIcon}
        color={colors.accent}
        className={hit}
        disabled={playBlocked}
        onPress={togglePlayPause}
      />
    </View>
  );
}
