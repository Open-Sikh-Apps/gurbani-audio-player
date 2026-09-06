import { useState } from "react";
import { Modal, useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";

import { AppIcon, type AppIconName } from "@/components/app-icon";
import { IconButton } from "@/components/icon-button";
import { useChrome } from "@/hooks/use-chrome";
import { usePreferencesStore } from "@/state/preferences-store";
import { useThemeColors } from "@/theme/use-theme-colors";
import { Pressable, Text, View, cn, ui } from "@/tw";

export type OverflowItem = {
  key: string;
  icon: AppIconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
};

type OverflowMenuProps = {
  extraItems?: OverflowItem[];
};

type OverflowMenuRowProps = {
  accessibilityRole: "button" | "switch";
  accessibilityState?: { checked?: boolean; disabled?: boolean };
  border: boolean;
  disabled?: boolean;
  hit: string;
  icon: AppIconName;
  iconColor: string;
  iconSize: number;
  label: string;
  onPress: () => void;
  text: string;
};

function OverflowMenuRow({
  accessibilityRole,
  accessibilityState,
  border,
  disabled,
  hit,
  icon,
  iconColor,
  iconSize,
  label,
  onPress,
  text,
}: OverflowMenuRowProps) {
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={label}
      accessibilityState={accessibilityState}
      className={cn(
        "flex-row items-center gap-3 px-4 py-3",
        hit,
        border && cn("border-t", ui.border),
        disabled && "opacity-40",
      )}
      disabled={disabled}
      onPress={onPress}
    >
      <AppIcon name={icon} size={iconSize} color={iconColor} />
      {/* shrink (not flex-1) so the panel can grow with the label; min-w-0 wraps at maxWidth. */}
      <Text className={cn("min-w-0 shrink", ui.text, text)}>{label}</Text>
    </Pressable>
  );
}

export function OverflowMenu({ extraItems = [] }: OverflowMenuProps) {
  const { t } = useTranslation();
  const { hit, text, tabIcon } = useChrome();
  const colors = useThemeColors();
  const { width: windowWidth } = useWindowDimensions();
  const simpleMode = usePreferencesStore((state) => state.simpleMode);
  const setSimpleMode = usePreferencesStore((state) => state.setSimpleMode);
  const keepScreenOn = usePreferencesStore((state) => state.keepScreenOnWhilePlaying);
  const setKeepScreenOn = usePreferencesStore(
    (state) => state.setKeepScreenOnWhilePlaying,
  );
  const [open, setOpen] = useState(false);

  function close(): void {
    setOpen(false);
  }

  return (
    <>
      <IconButton
        name="more-vert"
        accessibilityLabel={t("home.menu")}
        size={tabIcon}
        color={colors.accent}
        className={hit}
        onPress={() => setOpen(true)}
      />
      {/* Mount only while open — a hidden RN Modal still eats Android back.
          RN Modal is a separate window; without these, Android drops edge-to-edge on open. */}
      {open ? (
        <Modal
          visible
          transparent
          animationType="fade"
          statusBarTranslucent
          navigationBarTranslucent
          onRequestClose={close}
        >
          <Pressable className="flex-1" onPress={close}>
            {/* Absolute + min-w + flex-1 labels collapse to 224px and clip longer Punjabi/simple-mode copy. */}
            <View
              className={cn(
                "absolute top-16 right-3 min-w-56 overflow-hidden rounded-2xl border",
                ui.border,
                ui.surface,
              )}
              style={{ maxWidth: windowWidth - 80 }}
            >
              {extraItems.map((item, index) => (
                <OverflowMenuRow
                  key={item.key}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: item.disabled }}
                  border={index > 0}
                  disabled={item.disabled}
                  hit={hit}
                  icon={item.icon}
                  iconColor={colors.accent}
                  iconSize={tabIcon}
                  label={item.label}
                  text={text}
                  onPress={() => {
                    if (item.disabled) {
                      return;
                    }
                    // Close first so the modal does not eat the next Alert/sheet.
                    close();
                    item.onPress();
                  }}
                />
              ))}
              <OverflowMenuRow
                accessibilityRole="switch"
                accessibilityState={{ checked: simpleMode }}
                border={extraItems.length > 0}
                hit={hit}
                icon="text-fields"
                iconColor={colors.accent}
                iconSize={tabIcon}
                label={simpleMode ? t("home.simpleModeOff") : t("home.simpleModeOn")}
                text={text}
                onPress={() => {
                  setSimpleMode(!simpleMode);
                  close();
                }}
              />
              <OverflowMenuRow
                accessibilityRole="switch"
                accessibilityState={{ checked: keepScreenOn }}
                border
                hit={hit}
                icon={keepScreenOn ? "brightness-high" : "brightness-medium"}
                iconColor={colors.accent}
                iconSize={tabIcon}
                label={keepScreenOn ? t("home.keepScreenOff") : t("home.keepScreenOn")}
                text={text}
                onPress={() => {
                  setKeepScreenOn(!keepScreenOn);
                  close();
                }}
              />
            </View>
          </Pressable>
        </Modal>
      ) : null}
    </>
  );
}
