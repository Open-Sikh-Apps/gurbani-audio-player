import { REMOTE_IMAGE_HEADERS, pickThemedUrl, type ThemedMediaUrl } from "@/catalogue";
import { useIsDark } from "@/theme/use-theme-colors";
import { Image, cn } from "@/tw";

type CatalogueImageProps = {
  uri: ThemedMediaUrl | undefined;
  className?: string;
  accessibilityLabel: string;
};

export function CatalogueImage({
  uri,
  className,
  accessibilityLabel,
}: CatalogueImageProps) {
  const isDark = useIsDark();
  const resolved = pickThemedUrl(uri, isDark ? "dark" : "light");

  if (!resolved) {
    return null;
  }

  return (
    <Image
      // Some CDNs 403 a default RN user-agent; send the app UA.
      source={{
        uri: resolved,
        headers: REMOTE_IMAGE_HEADERS,
        // URL only so a later offline remount still hits the disk entry from the first load.
        cacheKey: resolved,
      }}
      cachePolicy="memory-disk"
      className={cn("w-full rounded-2xl object-cover", className)}
      accessibilityLabel={accessibilityLabel}
      accessibilityIgnoresInvertColors
    />
  );
}
