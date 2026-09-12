import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";

import {
  getReciterById,
  getScriptureById,
  getSehajPaathCollections,
  resolveL10n,
  useCatalogueStore,
  type SehajPaathCollection,
  type SehajPaathTrack,
} from "@/catalogue";
import { fileKey, useDownloadStore } from "@/downloads";
import { AppIcon } from "@/components/app-icon";
import { OverflowMenu } from "@/components/overflow-menu";
import { useChrome } from "@/hooks/use-chrome";
import { useDebouncedNavigation } from "@/hooks/use-debounced-navigation";
import { useResolvedLocale } from "@/hooks/use-resolved-locale";
import { useLibraryStore } from "@/state/library-store";
import { useThemeColors } from "@/theme/use-theme-colors";
import { FlashList, Pressable, Text, View, cn, ui } from "@/tw";

function LibraryAlbumRow({ item }: { item: SehajPaathCollection }) {
  const { t } = useTranslation();
  const { title, text, subtitle, hit, tabIcon } = useChrome();
  const locale = useResolvedLocale();
  const { navigate } = useDebouncedNavigation();
  const colors = useThemeColors();
  const catalogue = useCatalogueStore((state) => state.catalogue);
  const reciter = getReciterById(catalogue, item.reciterId);
  const scripture = getScriptureById(catalogue, item.scriptureId);
  const heading = reciter
    ? resolveL10n(reciter.name, locale)
    : item.id;
  const scriptureName = scripture ? resolveL10n(scripture.name, locale) : item.scriptureId;
  const downloaded = useDownloadStore((state) => {
    if (item.tracks.length === 0) {
      return false;
    }
    return item.tracks.every(
      (track: SehajPaathTrack) =>
        state.files[fileKey(track.id, track.url)]?.status === "completed",
    );
  });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t("collection.sehaj_paath")} · ${scriptureName} · ${heading}`}
      className={cn(
        "mb-4 rounded-2xl border px-4 py-4",
        ui.border,
        ui.surface,
        hit,
      )}
      // Library stack uses /album so the album modal belongs to this tab; Home uses /a.
      onPress={() => navigate(`/album/${item.id}`)}
    >
      <View className="flex-row items-center gap-2">
        <View className="flex-row flex-wrap min-w-0 flex-1">
          <Text className={cn(ui.text, subtitle, "shrink-0 max-w-full font-semibold")}>
            {`${t("collection.sehaj_paath")} · `}
          </Text>
          <Text className={cn(ui.text, subtitle, "shrink-0 max-w-full font-semibold")}>
            {scriptureName}
          </Text>
          <Text className={cn(ui.muted, subtitle, "shrink-0 max-w-full")}>
            {heading}
          </Text>
        </View>
        {downloaded ? (
          <AppIcon
            name="download-done"
            size={tabIcon}
            color={colors.accent}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

export function LibraryScreen() {
  const { t } = useTranslation();
  const { body, text, hit } = useChrome();
  const catalogue = useCatalogueStore((state) => state.catalogue);
  const albums = useLibraryStore((state) => state.albums);
  const { navigate } = useDebouncedNavigation();

  const byId = new Map(
    getSehajPaathCollections(catalogue).map((item) => [item.id, item]),
  );
  // Drop ids the latest catalogue no longer has rather than showing a dead row.
  const saved = Object.keys(albums)
    .map((id) => byId.get(id))
    .filter((item): item is NonNullable<typeof item> => item != null);

  return (
    <>
      <Stack.Screen
        options={{
          title: t("library.title"),
          headerRight: () => (
            <View className="flex-row items-center">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("history.title")}
                className={cn("justify-center px-3", hit)}
                onPress={() => navigate("/history")}
              >
                <Text className={cn(ui.accent, text)}>{t("history.title")}</Text>
              </Pressable>
              <OverflowMenu />
            </View>
          ),
        }}
      />
      {saved.length === 0 ? (
        <View className={cn("flex-1 items-center justify-center px-6", ui.page)}>
          <Text className={cn("text-center", ui.muted, body)}>
            {t("library.placeholder")}
          </Text>
        </View>
      ) : (
        <View className={cn("flex-1", ui.page)}>
          <FlashList
            data={saved}
            keyExtractor={(item) => item.id}
            contentContainerClassName="px-6 py-6"
            renderItem={({ item }) => <LibraryAlbumRow item={item} />}
          />
        </View>
      )}
    </>
  );
}
