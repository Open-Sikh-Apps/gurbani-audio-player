# `react-native-nitro-player` patch

We ship `react-native-nitro-player` **1.7.0-alpha.2** with a local `patch-package` overlay:

`patches/react-native-nitro-player+1.7.0-alpha.2.patch`

The stock library is a general playlist player (gapless window, skip-on-error, lock-screen prev/next). This app is **one album at a time**, **stop at the last track**, **±10 and prev/next both matter**, and **errors should wait for play()** rather than racing to the next file. The patch is the native half of that. JS still owns pause-rewind, resume, sleep timer, and the Settings toggle; it must not import this package outside `src/playback/`.

After editing native files in `node_modules`, regenerate with `npm run patch:nitro-player` (strips Android CMake/build junk). `postinstall` only **applies** the patch. A new native build is required (`npx expo run:ios` / `android`).

---

## Why we patch at all

Nitrogen-generated `PlayerConfig` has no extra fields. Flags we need (skip-on-error, remote primary, Android notification icon, http overflow) travel in `androidNotificationIcon` as a small token. Upstream adding real config keys would let us drop that side channel.

---

## What the patch adds

### Album queue, not a radio stream

- Playback **stops at the end of the album** (`repeat: off`). Ending a track must not leave the player “ready to play,” or a later seek (including pause-rewind) would restart the last seconds.
- Android can **load a playlist at a given track** without treating that track as window index 0, so previous-track still works after resume.

### ±10 across track boundaries

In-app and remote ±10 are **one hop**: leftover time lands on the neighbour. First-track −10 stays at 0; last-track +10 stays at the end. Stock seek clamped inside the current file.

Native has no NetInfo. JS packs `httpOverflow:1|0` in the same config token (`allowHttpOverflow`, default true). Online: leftover may start the next **stream**. Offline: leftover onto an `http(s)` neighbour **clamps**; `file:` neighbours still overflow. JS `subscribeNetwork` re-`configure`s when online flips.

### Lock screen, notification, Bluetooth (“remote primary”)

Settings chooses which pair is **primary** (default **±10**). Compact notification, lock screen, Bluetooth, and car follow that pair. The other pair is **secondary**: in-app always, and on Android the **expanded notification overflow**.

- **Android** can split compact vs overflow. When primary is ±10, overflow prev/next are custom session actions so a headset can still seek without also remapping expanded skip. Media3 hides “next” on the last item — the patch keeps +10 available there when primary is seek.
- **iOS** Control Center / lock screen: when primary is ±10, numbered skip-interval commands are enabled so the icons match; next/prev stay enabled so headset/car next-prev still seek ±10. When primary is track skip, next/prev skip tracks and the numbered buttons are hidden.

Headset prev/next go through the **logical album queue**, not ExoPlayer’s windowed timeline (which often has the playing item at index 0).

### Errors: stay put, tap play to retry

Stock behaviour skips to the next item on a source error. We default that **off**. The failed track stays current; JS shows an error; play() retries. Network restore / stall recovery must not auto-start after an error.

Android can show a failed state on the shade/lock screen (platform error code name only). iOS has no error slot there; pause + play-to-retry is the signal. `setSkipOnSourceError(true)` restores the library skip-to-next if we ever want it.

### Language change without restarting the file

`updateTracks` used to ignore the current item unless the URL was empty. Same URL, new title/artist/artwork (UI language or theme) now updates Now Playing / the media session without rebuilding the live queue. The gapless window (next 4 items) is refreshed in place so upcoming lock-screen / notification rows do not keep the old language or album art.

### Android swipe-kill relaunch (PlaylistManager)

Playing starts `NitroPlayerPlaybackService`. Swiping the app away kills the process; the next launch can create that service **before** React Native has loaded Nitro JNI. Stock playlist restore then constructs `AnyMap()` for `extraPayload` (`startAng`) and crashes (`UnsatisfiedLinkError` — that is an `Error`, so the existing `catch (Exception)` did not help).

The patch loads `JNIOnLoad.initializeNativeNitro()` first. If the `.so` is not ready, tracks still restore (id/url/title) with `extraPayload`/hybrid artwork skipped. JS `loadAlbum` rebuilds the live queue once RN is up.

### Android notification tap → Now Playing

API 33+ System UI sends `sessionActivity` as a single `getActivity` PendingIntent. Stock would not issue the Expo VIEW URI. The patch adds a transparent `SessionActivityTrampoline` that turns the tap into `gurbaniaudioplayer://now-playing` (same as `npx uri-scheme open`). Manifest: exported, `excludeFromRecents`, `noHistory`, translucent. Needs a new native Android build.

### Android notification small icon

The same config token can name a **drawable** (`notification_icon`). Prebuild copies `assets/notification-icon.png` into that resource. A string with no `:` is still treated as a bare icon name.

### Android mediaPlayback foreground while buffering

Media3 `isPlaying()` is false while buffering. `applyNotificationSmallIcon` used to call `onUpdateNotification(session, false)`, which **stops FGS** on a live stream (NetInfo reconfigure, remote-primary change). A cached process still decoding a stream is then `am_kill`’d for CPU (OnePlus: `oom_adj=935`).

The patch keeps `mediaPlayback` FGS while `playWhenReady` and state is `READY` or `BUFFERING`: `onUpdateNotification` ORs that in, and icon refresh passes `true`. Recents swipe / Close all **stop** playback (`onTaskRemoved`: `pauseAllPlayersAndStopSelf`).

### iOS TimeJumped, overflow play, empty-queue replay

Stock `AVPlayerItemTimeJumped` can emit the **pre-seek** time. Lock-screen previous-to-0 then left JS on the old position. The patch skips that notify when `isManuallySeeked` and emits the **requested** position from `seekInternal`’s completion.

±10 leftover that skips to a neighbour then `seek`s can leave AVPlayer paused. After that hop, native `playInternal()`s if `intendedToPlay` is still true.

Album end with `repeat: off` empties AVQueuePlayer. Lock-screen **play** rebuilds the last track at 0 (same as JS `engine.play()`). Error / empty-queue also clear `intendedToPlay` so `waitingToPlay` is not reported as buffering (stuck spinner at 0).

---

## What we deliberately do not patch in

Cast, equalizer, nitro-player downloads, CarPlay/Android Auto browse. Phase 5 downloads stay a separate stack. Car V1 is lock screen / notification / Bluetooth Now Playing only.
