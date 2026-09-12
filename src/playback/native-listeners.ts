import { Reason, TrackPlayer, TrackPlayerState } from "react-native-nitro-player";

export type NativePlayerListenerHandlers = {
  shouldIgnoreNative: () => boolean;
  onTrackChange: () => void;
  onPlaybackStateChange: (state: TrackPlayerState, reason?: Reason) => void;
  onProgress: (position: number, duration: number) => void;
  onSeek: (position: number, duration: number) => void;
};

export function attachNativePlayerListeners(
  handlers: NativePlayerListenerHandlers,
): void {
  TrackPlayer.onChangeTrack(() => {
    handlers.onTrackChange();
  });
  TrackPlayer.onPlaybackStateChange((state, reason) => {
    if (handlers.shouldIgnoreNative()) {
      return;
    }
    handlers.onPlaybackStateChange(state, reason);
  });
  TrackPlayer.onPlaybackProgressChange((position, duration) => {
    if (handlers.shouldIgnoreNative()) {
      return;
    }
    handlers.onProgress(position, duration);
  });
  TrackPlayer.onSeek((position, duration) => {
    if (handlers.shouldIgnoreNative()) {
      return;
    }
    handlers.onSeek(position, duration);
  });
}
