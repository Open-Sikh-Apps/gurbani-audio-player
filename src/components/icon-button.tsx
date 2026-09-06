import { useEffect, useRef, useState } from "react";
import { Modal, View as RNView, useWindowDimensions } from "react-native";

import { AppIcon, type AppIconName } from "@/components/app-icon";
import { Pressable, Text, View, cn, ui } from "@/tw";

type IconButtonProps = {
  name: AppIconName;
  accessibilityLabel: string;
  size: number;
  color: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
  filled?: boolean;
  className?: string;
};

type Anchor = { x: number; y: number; width: number; height: number };

export function IconButton({
  name,
  accessibilityLabel,
  size,
  color,
  onPress,
  disabled,
  selected,
  filled,
  className,
}: IconButtonProps) {
  const hostRef = useRef<RNView>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const { height: windowHeight } = useWindowDimensions();

  useEffect(() => {
    if (!anchor) {
      return;
    }
    // Auto-dismiss so a forgotten long-press does not leave a modal blocking taps.
    const timer = setTimeout(() => setAnchor(null), 1800);
    return () => clearTimeout(timer);
  }, [anchor]);

  function showTooltip(): void {
    hostRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
    });
  }

  // Transport controls sit near the bottom; flip the tooltip up so it stays on screen.
  const showAbove = anchor != null && anchor.y > windowHeight * 0.7;

  return (
    <>
      {/* Native View so measureInWindow works; @/tw View does not forward refs. */}
      <RNView ref={hostRef} collapsable={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ disabled, selected }}
          className={cn(
            "items-center justify-center px-2",
            filled && cn("rounded-full", ui.fillAccent),
            disabled && "opacity-40",
            className,
          )}
          disabled={disabled}
          onPress={onPress}
          onLongPress={showTooltip}
          delayLongPress={400}
        >
          <AppIcon name={name} size={size} color={color} />
        </Pressable>
      </RNView>
      {/* Mount only while open — a hidden RN Modal still eats Android back. */}
      {anchor ? (
        <Modal
          visible
          transparent
          animationType="fade"
          statusBarTranslucent
          navigationBarTranslucent
          onRequestClose={() => setAnchor(null)}
        >
          <Pressable className="flex-1" onPress={() => setAnchor(null)}>
            <View
              pointerEvents="none"
              className={cn("absolute rounded-lg border px-3 py-2", ui.border, ui.surface)}
              style={{
                top: showAbove ? anchor.y - 44 : anchor.y + anchor.height + 8,
                left: Math.max(8, anchor.x + anchor.width / 2 - 80),
                maxWidth: 220,
              }}
            >
              <Text className={cn("text-center", ui.text)}>{accessibilityLabel}</Text>
            </View>
          </Pressable>
        </Modal>
      ) : null}
    </>
  );
}
