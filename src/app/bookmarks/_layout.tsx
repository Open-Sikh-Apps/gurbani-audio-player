import { Stack } from "expo-router";

import { AppToastSlot } from "@/feedback/toast";
import { IosModalOfflineBanner } from "@/components/offline-chrome";
import { useOfflineStackOptions } from "@/hooks/use-offline-stack-options";
import { useSafeBottomPad } from "@/hooks/use-safe-bottom-pad";
import { useThemeColors } from "@/theme/use-theme-colors";
import { View } from "@/tw";

export default function BookmarksModalLayout() {
  const bottom = useSafeBottomPad();
  const colors = useThemeColors();
  const offlineHeader = useOfflineStackOptions();

  // Full-screen modal sits outside the tab-bar toast host. `relative` pins this slot to the modal, not the window under it.
  return (
    <View className="relative flex-1">
      <IosModalOfflineBanner />
      <Stack
        screenOptions={{
          ...offlineHeader,
          // Modal stacks do not inherit tab safe-area; content would sit under the home indicator.
          contentStyle: { paddingBottom: bottom, backgroundColor: colors.bg },
        }}
      />
      <AppToastSlot padSafeArea />
    </View>
  );
}
