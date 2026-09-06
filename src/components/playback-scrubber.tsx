import { useEffect, useRef, useState } from "react";
import type { GestureResponderEvent, LayoutChangeEvent } from "react-native";
import { useTranslation } from "react-i18next";

import { useChrome } from "@/hooks/use-chrome";
import { formatDuration } from "@/playback";
import { useThemeColors } from "@/theme/use-theme-colors";
import { Text, View, cn, ui } from "@/tw";

const A11Y_SEEK_SEC = 10;
const SEEK_SETTLE_SEC = 1.25;

type PlaybackScrubberProps = {
  positionSec: number;
  durationSec: number;
  onSeek: (positionSec: number) => void;
};

export function PlaybackScrubber({
  positionSec,
  durationSec,
  onSeek,
}: PlaybackScrubberProps) {
  const { t } = useTranslation();
  const { simpleMode, text, scrubberTrack, scrubberThumb } = useChrome();
  const colors = useThemeColors();
  const widthRef = useRef(1);
  const trackPageX = useRef(0);
  const draggingRef = useRef(false);
  const pendingSeekSec = useRef<number | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Preview while dragging so coalesced native progress ticks do not yank the thumb.
  const [previewSec, setPreviewSec] = useState<number | null>(null);

  const duration = Math.max(0, durationSec);
  const disabled = duration <= 0;
  const displayed = previewSec ?? positionSec;
  const ratio = duration > 0 ? Math.min(1, Math.max(0, displayed / duration)) : 0;

  useEffect(() => {
    if (pendingSeekSec.current == null) {
      return;
    }
    if (Math.abs(positionSec - pendingSeekSec.current) < SEEK_SETTLE_SEC) {
      pendingSeekSec.current = null;
      if (settleTimer.current) {
        clearTimeout(settleTimer.current);
        settleTimer.current = null;
      }
      setPreviewSec(null);
    }
  }, [positionSec]);

  function positionFromPageX(pageX: number): number {
    // pageX is window-relative so child views cannot steal the hit like locationX does.
    const fraction = Math.min(
      1,
      Math.max(0, (pageX - trackPageX.current) / widthRef.current),
    );
    return fraction * duration;
  }

  function onLayout(event: LayoutChangeEvent): void {
    widthRef.current = event.nativeEvent.layout.width || 1;
    event.currentTarget.measureInWindow((pageX) => {
      trackPageX.current = pageX;
    });
  }

  function onGrant(event: GestureResponderEvent): void {
    if (disabled) {
      return;
    }
    draggingRef.current = true;
    pendingSeekSec.current = null;
    setPreviewSec(positionFromPageX(event.nativeEvent.pageX));
  }

  function onMove(event: GestureResponderEvent): void {
    if (!draggingRef.current || disabled) {
      return;
    }
    setPreviewSec(positionFromPageX(event.nativeEvent.pageX));
  }

  function onRelease(event: GestureResponderEvent): void {
    if (!draggingRef.current || disabled) {
      return;
    }
    draggingRef.current = false;
    const next = positionFromPageX(event.nativeEvent.pageX);
    pendingSeekSec.current = next;
    setPreviewSec(next);
    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
    }
    // Drop the preview if native never reports the seeked position.
    settleTimer.current = setTimeout(() => {
      pendingSeekSec.current = null;
      setPreviewSec(null);
    }, 2500);
    onSeek(next);
  }

  function onTerminate(): void {
    draggingRef.current = false;
    pendingSeekSec.current = null;
    setPreviewSec(null);
  }

  return (
    <View className="w-full gap-2">
      <View className="flex-row justify-between">
        <Text className={cn(ui.muted, text)}>{formatDuration(displayed)}</Text>
        <Text className={cn(ui.muted, text)}>{formatDuration(duration)}</Text>
      </View>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={t("player.scrubber")}
        accessibilityState={{ disabled }}
        accessibilityValue={{
          min: 0,
          max: Math.floor(duration),
          now: Math.floor(displayed),
        }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => {
          if (disabled) {
            return;
          }
          if (event.nativeEvent.actionName === "increment") {
            onSeek(Math.min(duration, displayed + A11Y_SEEK_SEC));
            return;
          }
          if (event.nativeEvent.actionName === "decrement") {
            onSeek(Math.max(0, displayed - A11Y_SEEK_SEC));
          }
        }}
        className={cn("justify-center py-3", disabled && "opacity-40")}
        onLayout={onLayout}
        onStartShouldSetResponder={() => !disabled}
        onMoveShouldSetResponder={() => !disabled}
        onResponderGrant={onGrant}
        onResponderMove={onMove}
        onResponderRelease={onRelease}
        onResponderTerminate={onTerminate}
      >
        <View
          pointerEvents="none"
          className={cn("w-full overflow-hidden rounded-full", ui.fillBorder, scrubberTrack)}
        >
          <View
            pointerEvents="none"
            className={cn("rounded-full", ui.fillAccent, scrubberTrack)}
            style={{ width: `${ratio * 100}%` }}
          />
        </View>
        <View
          pointerEvents="none"
          className={cn(
            "absolute rounded-full border-2",
            ui.fillSurface,
            simpleMode ? "-mt-3.5" : "-mt-2",
          )}
          style={{
            width: scrubberThumb,
            height: scrubberThumb,
            left: `${ratio * 100}%`,
            marginLeft: -scrubberThumb / 2,
            borderColor: colors.accent,
          }}
        />
      </View>
    </View>
  );
}
