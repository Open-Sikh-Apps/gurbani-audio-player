import { useChrome } from "@/hooks/use-chrome";
import { useThemeColors } from "@/theme/use-theme-colors";
import { Text, View, cn, ui } from "@/tw";

export function DownloadProgress({
  percent,
  done,
  total,
  className,
}: {
  percent: number;
  done?: number;
  total?: number;
  className?: string;
}) {
  const colors = useThemeColors();
  const { bodySmall, simpleMode } = useChrome();
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const label =
    done != null && total != null && total > 0
      ? `${done}/${total}`
      : `${clamped}%`;

  return (
    <View className={cn("min-w-16 items-center gap-1", className)}>
      <View
        className={cn(
          "w-full overflow-hidden rounded-full",
          simpleMode ? "h-2.5" : "h-1.5",
          ui.fillBorder,
        )}
      >
        <View
          className="h-full rounded-full"
          // NativeWind cannot interpolate width from a live percent; accent is inline for the same reason.
          style={{ width: `${clamped}%`, backgroundColor: colors.accent }}
        />
      </View>
      <Text className={cn("text-center font-semibold", bodySmall, ui.muted)}>
        {label}
      </Text>
    </View>
  );
}
