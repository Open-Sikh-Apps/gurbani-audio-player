import { useEffect, useState } from "react";
import { REMOTE_IMAGE_HEADERS, pickThemedUrl, type ThemedMediaUrl } from "@/catalogue";
import { useIsOnline } from "@/downloads";
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
  const online = useIsOnline();
  const isDark = useIsDark();
  const resolved = pickThemedUrl(uri, isDark ? "dark" : "light");
  const [failed, setFailed] = useState(false);

  // Retry after reconnect or a new uri; a prior onError would otherwise keep the image hidden.
  useEffect(() => {
    if (online) {
      setFailed(false);
    }
  }, [online, resolved]);

  // Hide a broken image while offline; while online, keep Image mounted so it can retry.
  if (!resolved || (failed && !online)) {
    return null;
  }

  return (
    <Image
      source={{
        uri: resolved,
        headers: REMOTE_IMAGE_HEADERS,
        cacheKey: resolved,
      }}
      cachePolicy="memory-disk"
      className={cn("w-full rounded-2xl object-cover", className)}
      accessibilityLabel={accessibilityLabel}
      accessibilityIgnoresInvertColors
      onError={() => setFailed(true)}
      onLoad={() => setFailed(false)}
    />
  );
}
