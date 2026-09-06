import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FlashListRef } from "@shopify/flash-list";

import {
  getCollectionById,
  getReciterById,
  getScriptureById,
  getTrackInCollection,
  resolveL10n,
  useCatalogueStore,
  type SehajPaathCollection,
  type SehajPaathTrack,
} from "@/catalogue";
import {
  AlbumActionRow,
  confirmRemove,
  DownloadOptionsSheet,
  type DownloadSheetOptions,
} from "@/components/album-action-row";
import { AppIcon } from "@/components/app-icon";
import { DownloadProgress } from "@/components/download-progress";
import { HeaderCloseButton } from "@/components/header-close-button";
import { OverflowMenu } from "@/components/overflow-menu";
import {
  cancelDownloads,
  enqueueDownloads,
  fileKey,
  isCurrentlyPlayingTrack,
  isTrackDownloaded,
  isTrackDownloading,
  removeDownloadedTracks,
  useDownloadStore,
  useIsOnline,
  type DownloadFile,
  type DownloadTrackInput,
} from "@/downloads";
import { useChrome } from "@/hooks/use-chrome";
import { useDebouncedNavigation } from "@/hooks/use-debounced-navigation";
import { LIST_PLAY_PRESS_DELAY_MS } from "@/hooks/list-play-press";
import { useResolvedLocale } from "@/hooks/use-resolved-locale";
import {
  formatDuration,
  isEndedAlbumResume,
  midTrackResumeSec,
  playAlbum,
  sessionFromSehajPaath,
  togglePlayPause,
  usePlaybackStore,
  useResumeStore,
  type SessionTrack,
} from "@/playback";
import { useLibraryStore } from "@/state/library-store";
import { useThemeColors } from "@/theme/use-theme-colors";
import { FlashList, Pressable, Text, View, cn, ui } from "@/tw";

type AlbumRow = SessionTrack | SehajPaathTrack;

// SessionTrack.url may be file:// after a pin; download keys must use the CDN URL.
function remoteUrlOf(track: AlbumRow): string {
  return "remoteUrl" in track ? track.remoteUrl : track.url;
}

function fileInFlight(file: DownloadFile | undefined): boolean {
  return file?.status === "queued" || file?.status === "downloading";
}

function AlbumHeaderProgress({ albumId }: { albumId: string }) {
  const batch = useDownloadStore((state) => state.batches[albumId]);
  if (!batch || batch.total === 0) {
    return null;
  }
  return (
    <View className="shrink-0">
      <DownloadProgress
        percent={batch.percent}
        done={batch.done}
        total={batch.total}
      />
    </View>
  );
}

// Live position lives here so FlashList does not re-render on every progress tick.
function AlbumResumeButton({
  albumId,
  tracks,
  online,
  locale,
  onPlayFrom,
}: {
  albumId: string;
  tracks: AlbumRow[];
  online: boolean;
  locale: string;
  onPlayFrom: (track: AlbumRow, fromPositionSec?: number) => void;
}) {
  const { t } = useTranslation();
  const { text, hit } = useChrome();
  const { navigate } = useDebouncedNavigation();
  const catalogue = useCatalogueStore((state) => state.catalogue);
  const isCurrentAlbum = usePlaybackStore(
    (state) => state.session?.albumId === albumId,
  );
  const currentTrackId = usePlaybackStore((state) => state.currentTrackId);
  const playing = usePlaybackStore((state) => state.playing);
  const positionSec = usePlaybackStore((state) => state.positionSec);
  const liveDurationSec = usePlaybackStore((state) => state.durationSec);
  const albumEnded = usePlaybackStore((state) => state.albumEnded);
  const storedResume = useResumeStore((state) => state.positions[albumId]);
  const resume =
    isCurrentAlbum && currentTrackId
      ? {
          trackId: currentTrackId,
          positionSec,
          durationSec: liveDurationSec > 0 ? liveDurationSec : undefined,
        }
      : storedResume;
  const resumeTrack = resume
    ? (tracks.find((track) => track.id === resume.trackId) ??
      (getTrackInCollection(catalogue, albumId, resume.trackId) as
        | AlbumRow
        | undefined))
    : undefined;
  const resumeAt =
    resume && resumeTrack
      ? midTrackResumeSec(
          resume.positionSec,
          resume.durationSec ??
            ("durationSec" in resumeTrack ? resumeTrack.durationSec : undefined),
        )
      : null;
  const albumPlaying = isCurrentAlbum && playing;
  const albumEndedResume =
    resume != null &&
    isEndedAlbumResume(
      resume,
      tracks[tracks.length - 1]?.id,
      resume.durationSec ??
        (resumeTrack && "durationSec" in resumeTrack
          ? resumeTrack.durationSec
          : undefined),
      isCurrentAlbum && albumEnded,
    );
  if (!resumeTrack) {
    return null;
  }
  const resumeLabel = albumPlaying
    ? t("album.playing")
    : albumEndedResume
      ? t("album.ended")
      : t("album.resume");
  const resumeA11y = albumPlaying
    ? t("album.playing")
    : albumEndedResume
      ? t("album.endedA11y")
      : t("album.resume");
  const resumeOnDisk = isTrackDownloaded(
    resumeTrack.id,
    remoteUrlOf(resumeTrack),
  );
  const resumeDisabled = !albumPlaying && !online && !resumeOnDisk;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={resumeA11y}
      accessibilityState={{ disabled: resumeDisabled }}
      className={cn(
        "rounded-2xl border px-4 py-3",
        ui.borderAccent,
        ui.surface,
        hit,
        resumeDisabled && "opacity-50",
      )}
      disabled={resumeDisabled}
      unstable_pressDelay={LIST_PLAY_PRESS_DELAY_MS}
      onPress={() => {
        // Playing: open the player. Paused: playFrom also navigates after load.
        if (albumPlaying) {
          navigate("/now-playing");
          return;
        }
        onPlayFrom(resumeTrack, resumeAt ?? 0);
      }}
    >
      <Text className={cn(ui.accent, text)}>{resumeLabel}</Text>
      <Text className={cn("mt-1", ui.muted, text)}>
        {resolveL10n(resumeTrack.title, locale)}
        {resumeAt != null ? ` · ${formatDuration(resumeAt)}` : null}
      </Text>
    </Pressable>
  );
}

function AlbumTrackRow({
  item,
  albumId,
  downloadable,
  selecting,
  selected,
  online,
  locale,
  onToggleSelected,
  onPlay,
  onTrackDownload,
}: {
  item: AlbumRow;
  albumId: string;
  downloadable: boolean;
  selecting: boolean;
  selected: boolean;
  online: boolean;
  locale: string;
  onToggleSelected: (id: string) => void;
  onPlay: (item: AlbumRow) => void;
  onTrackDownload: (item: AlbumRow) => void;
}) {
  const { t } = useTranslation();
  const { text, hit, tabIcon } = useChrome();
  const colors = useThemeColors();
  const url = remoteUrlOf(item);
  const key = fileKey(item.id, url);
  const file = useDownloadStore((state) => state.files[key]);
  const active = usePlaybackStore(
    (state) =>
      state.session?.albumId === albumId && state.currentTrackId === item.id,
  );
  const playingNow = usePlaybackStore(
    (state) =>
      (state.playing || state.buffering) && state.currentTrackId === item.id,
  );
  const downloaded = file?.status === "completed";
  const downloading = fileInFlight(file);
  const muted = !online && !downloaded;
  const selectable = !downloaded && !downloading;
  const durationLabel =
    item.durationSec != null ? formatDuration(item.durationSec) : null;
  const sublabel = downloading
    ? durationLabel
      ? `${t("download.downloading")} · ${durationLabel}`
      : t("download.downloading")
    : durationLabel;
  const titleLabel = resolveL10n(item.title, locale);

  return (
    <View
      className={cn(
        "mb-4 flex-row items-center rounded-2xl border",
        active ? ui.borderAccent : ui.border,
        ui.surface,
        (muted || (selecting && !selectable)) && "opacity-50",
      )}
    >
      <Pressable
        accessibilityRole={selecting ? "checkbox" : "button"}
        accessibilityState={{
          disabled: (muted && !selecting) || (selecting && !selectable),
          checked: selecting ? selected : undefined,
          selected: active,
        }}
        accessibilityLabel={
          downloading
            ? `${titleLabel}, ${t("download.downloading")}`
            : titleLabel
        }
        className={cn("min-w-0 flex-1 px-4 py-4", hit)}
        disabled={(muted && !selecting) || (selecting && !selectable)}
        unstable_pressDelay={LIST_PLAY_PRESS_DELAY_MS}
        onPress={() => {
          if (selecting) {
            if (!selectable) {
              return;
            }
            onToggleSelected(item.id);
            return;
          }
          onPlay(item);
        }}
      >
        <View className="flex-row items-center gap-3">
          {selecting ? (
            <AppIcon
              name={
                downloaded
                  ? "download-done"
                  : selected
                    ? "check-box"
                    : "check-box-outline-blank"
              }
              size={tabIcon}
              color={colors.accent}
            />
          ) : null}
          <View className="min-w-0 flex-1">
            <Text className={cn(active ? ui.accent : ui.text, text)}>
              {titleLabel}
            </Text>
            {sublabel ? (
              <Text className={cn("mt-1", ui.muted, text)}>{sublabel}</Text>
            ) : null}
          </View>
        </View>
      </Pressable>
      {downloadable && !selecting ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            downloading
              ? t("download.stopDownload")
              : downloaded
                ? t("download.removeTrack")
                : t("download.downloadTrack")
          }
          accessibilityState={{
            disabled:
              (downloaded && playingNow) ||
              (!online && !downloaded && !downloading),
          }}
          className={cn(
            "items-center justify-center px-3",
            hit,
            playingNow && downloaded && "opacity-50",
          )}
          // Deleting the file under the player would stall the current track.
          disabled={
            (downloaded && playingNow) ||
            (!online && !downloaded && !downloading)
          }
          onPress={() => onTrackDownload(item)}
        >
          <AppIcon
            name={
              downloading
                ? "downloading"
                : downloaded
                  ? "download-done"
                  : "cloud-download"
            }
            size={tabIcon}
            color={colors.accent}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

export function AlbumScreen() {
  const { t } = useTranslation();
  const { body, text, title } = useChrome();
  const locale = useResolvedLocale();
  const { navigate } = useDebouncedNavigation();
  const { albumId, trackId } = useLocalSearchParams<{
    albumId: string;
    trackId?: string | string[];
  }>();
  const deepTrackId = Array.isArray(trackId) ? trackId[0] : trackId;

  const catalogue = useCatalogueStore((state) => state.catalogue);
  const collection = getCollectionById(catalogue, albumId);
  const sehaj =
    collection?.kind === "sehaj_paath"
      ? (collection as SehajPaathCollection)
      : undefined;
  const reciter = sehaj
    ? getReciterById(catalogue, sehaj.reciterId)
    : undefined;
  const scripture = sehaj
    ? getScriptureById(catalogue, sehaj.scriptureId)
    : undefined;
  const session = usePlaybackStore((state) => state.session);
  const currentTrackId = usePlaybackStore((state) => state.currentTrackId);
  const playing = usePlaybackStore((state) => state.playing);
  const buffering = usePlaybackStore((state) => state.buffering);
  const inLibrary = useLibraryStore((state) => state.albums[albumId] != null);
  const toggleAlbum = useLibraryStore((state) => state.toggleAlbum);
  const online = useIsOnline();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);
  const listRef = useRef<FlashListRef<AlbumRow> | null>(null);

  const liveSession = useMemo(() => {
    if (sehaj) {
      return sessionFromSehajPaath(sehaj, reciter, scripture);
    }
    // Catalogue dropped this album; keep the frozen session so the playing queue still has a screen.
    if (session?.albumId === albumId) {
      return session;
    }
    return null;
  }, [albumId, reciter, scripture, sehaj, session]);

  const heading = liveSession
    ? resolveL10n(liveSession.reciterName, locale)
    : t("album.title");
  const tracks: AlbumRow[] = sehaj?.tracks ?? liveSession?.tracks ?? [];
  const isCurrentAlbum = session?.albumId === albumId;

  // `?trackId=` (Now Playing album button) is scroll-only. Wait one frame so
  // FlashList has measured. Do not playAlbum here — that restarted from 0.
  useEffect(() => {
    if (!deepTrackId) {
      return;
    }
    const index = tracks.findIndex((track) => track.id === deepTrackId);
    if (index < 0) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToIndex({
          index,
          viewPosition: 0.25,
        });
      } catch {
        // List has not measured this row yet.
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [deepTrackId, tracks]);
  const downloadable = sehaj?.downloadable === true;

  const reciterName = reciter
    ? resolveL10n(reciter.name, locale)
    : heading;
  const kindLabel = sehaj ? t(`collection.${sehaj.kind}`) : t("album.title");
  const scriptureName = scripture
    ? resolveL10n(scripture.name, locale)
    : null;

  function toDownloadInput(track: AlbumRow): DownloadTrackInput {
    const fromCatalogue = getTrackInCollection(catalogue, albumId, track.id);
    const byteSize =
      track.byteSize ??
      (fromCatalogue && "byteSize" in fromCatalogue
        ? fromCatalogue.byteSize
        : 0);
    return {
      albumId,
      trackId: track.id,
      remoteUrl: remoteUrlOf(track),
      byteSize,
      title: resolveL10n(track.title, locale),
      reciterName,
      albumTitle: `${reciterName} · ${kindLabel}`,
    };
  }

  const inputs: DownloadTrackInput[] = tracks.map(toDownloadInput);
  const hasAnyDownload = useDownloadStore((state) =>
    tracks.some(
      (track) =>
        state.files[fileKey(track.id, remoteUrlOf(track))]?.status ===
        "completed",
    ),
  );

  // `?trackId=` only scrolls (Now Playing album button). Do not playAlbum —
  // that restarted the current track from 0. Share/deeplink play can use a
  // dedicated query later.

  async function playFrom(
    track: AlbumRow,
    fromPositionSec?: number,
  ): Promise<void> {
    if (!liveSession) {
      return;
    }
    const local = isTrackDownloaded(track.id, remoteUrlOf(track));
    if (!online && !local) {
      return;
    }
    // Same-row tap opens the player; pause lives on Now Playing / the mini player.
    if (
      fromPositionSec == null &&
      isCurrentAlbum &&
      currentTrackId === track.id
    ) {
      if (!playing && !buffering) {
        togglePlayPause();
      }
      navigate("/now-playing");
      return;
    }
    const started = await playAlbum(liveSession, {
      trackId: track.id,
      positionSec: fromPositionSec ?? 0,
    });
    if (started) {
      navigate("/now-playing");
    }
  }

  function toggleSelected(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  if (!liveSession) {
    return (
      <>
        <Stack.Screen
          options={{
            title: t("album.title"),
            headerBackVisible: false,
            headerLeft: () => <HeaderCloseButton />,
            headerRight: () => <OverflowMenu />,
          }}
        />
        <View className={cn("flex-1 items-center justify-center px-6", ui.page)}>
          <Text className={cn("text-center", ui.muted, body)}>
            {t("album.unavailable")}
          </Text>
        </View>
      </>
    );
  }

  // Offline still opens the sheet so Remove all is reachable when files exist.
  const downloadActionDisabled = !online && !hasAnyDownload;

  const sheetOptions: DownloadSheetOptions = {
    title: t("download.action"),
    downloadAll: online ? t("download.all") : null,
    select: online ? t("download.select") : null,
    removeAll: hasAnyDownload ? t("download.removeAll") : null,
    cancel: t("download.cancel"),
    onDownloadAll: () => {
      void enqueueDownloads(inputs, "batch");
    },
    onSelect: () => {
      setSelecting(true);
      setSelected(new Set());
    },
    onRemoveAll: () => {
      confirmRemove({
        title: t("download.removeAllTitle"),
        body: t("download.removeAllBody"),
        confirm: t("download.remove"),
        cancel: t("download.cancel"),
        onConfirm: () => {
          void removeDownloadedTracks(inputs);
        },
      });
    },
  };

  function openDownloadSheet(): void {
    setSheetOpen(true);
  }

  function onTrackDownload(track: AlbumRow): void {
    const url = remoteUrlOf(track);
    if (isTrackDownloading(track.id)) {
      confirmRemove({
        title: t("download.cancelTrackTitle"),
        body: t("download.cancelTrackBody"),
        confirm: t("download.stopDownload"),
        cancel: t("download.keepDownloading"),
        onConfirm: () => {
          void cancelDownloads([toDownloadInput(track)]);
        },
      });
      return;
    }
    if (isTrackDownloaded(track.id, url)) {
      if (isCurrentlyPlayingTrack(track.id)) {
        return;
      }
      confirmRemove({
        title: t("download.removeTrackTitle"),
        body: t("download.removeTrackBody"),
        confirm: t("download.remove"),
        cancel: t("download.cancel"),
        onConfirm: () => {
          void removeDownloadedTracks([toDownloadInput(track)]);
        },
      });
      return;
    }
    void enqueueDownloads([toDownloadInput(track)], "single");
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: kindLabel,
          headerBackVisible: false,
          headerLeft: () => <HeaderCloseButton />,
          headerRight: () => <OverflowMenu />,
        }}
      />
      <View className={cn("flex-1", ui.page)}>
        <View className="flex-1">
          {/* FlashList caches rows; extraData forces a re-render when selection or online changes. */}
          <FlashList
            ref={listRef}
            extraData={{ selecting, selected, online }}
            data={tracks}
            keyExtractor={(item) => item.id}
            contentContainerClassName="px-6 py-6"
            ListHeaderComponent={
              <View className="gap-3 py-4">
                <View className="w-full flex-row items-center justify-between gap-3">
                  <View className="min-w-0 flex-1">
                    <Text className={cn("font-semibold", ui.text, title)}>
                      {scriptureName ? scriptureName : heading}
                    </Text>
                    {scriptureName ? (
                      <Text className={cn(ui.muted, text)}>{heading}</Text>
                    ) : null}
                  </View>
                  <AlbumHeaderProgress albumId={albumId} />
                </View>
                <AlbumResumeButton
                  albumId={albumId}
                  tracks={tracks}
                  online={online}
                  locale={locale}
                  onPlayFrom={(track, fromPositionSec) => {
                    void playFrom(track, fromPositionSec);
                  }}
                />
                {selecting ? (
                  <AlbumActionRow
                    items={[
                      {
                        key: "cancel",
                        icon: "close",
                        label: t("download.cancel"),
                        onPress: () => {
                          setSelecting(false);
                          setSelected(new Set());
                        },
                      },
                      {
                        key: "all",
                        icon: "done-all",
                        label: t("download.selectAll"),
                        onPress: () => {
                          const next = new Set<string>();
                          for (const track of tracks) {
                            if (
                              isTrackDownloaded(track.id, remoteUrlOf(track)) ||
                              isTrackDownloading(track.id)
                            ) {
                              continue;
                            }
                            next.add(track.id);
                          }
                          setSelected(next);
                        },
                      },
                      {
                        key: "go",
                        icon: "cloud-download",
                        label: t("download.downloadSelected"),
                        disabled: selected.size === 0,
                        onPress: () => {
                          const chosen = inputs.filter((item) =>
                            selected.has(item.trackId),
                          );
                          void enqueueDownloads(chosen, "batch");
                          setSelecting(false);
                          setSelected(new Set());
                        },
                      },
                    ]}
                  />
                ) : (
                  <AlbumActionRow
                    items={[
                      {
                        key: "bookmarks",
                        icon: "bookmarks",
                        label: t("bookmark.listTitle"),
                        onPress: () =>
                          navigate(
                            `/bookmarks?albumId=${encodeURIComponent(albumId)}`,
                          ),
                      },
                      {
                        key: "library",
                        icon: inLibrary ? "favorite" : "favorite-border",
                        label: inLibrary
                          ? t("library.remove")
                          : t("library.add"),
                        onPress: () => toggleAlbum(albumId),
                      },
                      ...(downloadable
                        ? [
                          {
                            key: "download",
                            icon: "cloud-download" as const,
                            label: t("download.action"),
                            disabled: downloadActionDisabled,
                            onPress: openDownloadSheet,
                          },
                        ]
                        : []),
                    ]}
                  />
                )}
              </View>
            }
            renderItem={({ item }) => (
              <AlbumTrackRow
                item={item}
                albumId={albumId}
                downloadable={downloadable}
                selecting={selecting}
                selected={selected.has(item.id)}
                online={online}
                locale={locale}
                onToggleSelected={toggleSelected}
                onPlay={(track) => {
                  void playFrom(track);
                }}
                onTrackDownload={onTrackDownload}
              />
            )}
          />
        </View>
      </View>
      <DownloadOptionsSheet
        visible={sheetOpen}
        options={sheetOptions}
        onClose={() => setSheetOpen(false)}
      />
    </>
  );
}
