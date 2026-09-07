import type { AppIconName } from "@/components/app-icon";
import { IconButton } from "@/components/icon-button";
import { useChrome } from "@/hooks/use-chrome";
import { useThemeColors } from "@/theme/use-theme-colors";
import { Pressable, Text, View, cn, ui } from "@/tw";

type NowPlayingActionProps = {
  name: AppIconName;
  accessibilityLabel: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
  filled?: boolean;
};

export function NowPlayingAction({
  name,
  accessibilityLabel,
  label,
  onPress,
  disabled,
  selected,
  filled,
}: NowPlayingActionProps) {
  const { nowPlayingActionText, playerIcon, hit, simpleMode } = useChrome();
  const colors = useThemeColors();
  // RN still splits a word if the box is narrower than that word. One line per
  // space-separated token so the column grows to the longest word instead.
  const stacked = label.trim().split(/\s+/).join("\n");
  return (
    <Pressable
      className={cn("items-center", simpleMode ? "min-w-16" : "min-w-14")}
      disabled={disabled}
      onPress={onPress}
    >
      <IconButton
        name={name}
        accessibilityLabel={accessibilityLabel}
        size={playerIcon}
        color={filled ? colors.accentFg : colors.accent}
        className={hit}
        disabled={disabled}
        selected={selected}
        filled={filled}
        onPress={onPress}
      />
      <Text
        className={cn(
          disabled ? ui.muted : ui.accent,
          nowPlayingActionText,
          "text-center",
          disabled && "opacity-40",
        )}
        textBreakStrategy="simple"
      >
        {stacked}
      </Text>
    </Pressable>
  );
}
