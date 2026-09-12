# `nitro-player-adapter.ts` walkthrough

This file is the only place native `TrackPlayer` / `PlayerQueue` is allowed. Screens talk to `src/playback/store.ts`, which talks to this engine. The adapter’s job is: **keep one frozen album in JS, keep one native playlist in sync with it, and never let native’s messy events write the wrong resume position.**

The web stub (`nitro-player-adapter.web.ts`) is a no-op engine; nothing here runs in the browser.

---

## Two worlds

**JS session** (`session`) is the source of truth: album id, track ids, `url` (what we want native to play), `remoteUrl` (CDN identity). It is a copy (`freezeSession`), so a catalogue refresh cannot mutate the live queue.

**Native** is ExoPlayer / AVPlayer behind nitro. It has its own playlist, its own current index, and it fires progress/seek/track-change/state events that can be stale, from the *previous* album, or from a player that already died.

Almost every flag in this file exists because those two worlds disagree for a few hundred milliseconds.

---

## Closure state

Read these as a group around lines 63–87:

| Field | Why it exists |
|---|---|
| `session` | Frozen album currently loaded. |
| `nativeSourceUrls` | URLs we last *sent* into native. Nitro’s `currentTrack.url` often lies, so we never compare against that. |
| `nativePlaylistId` | Current native playlist so we can prune leftovers. |
| `cachedNative` | Last `getState()` snapshot. Progress/seek patch this locally so the UI does not wait for another round-trip. |
| `rate` | Last known speed; native read can fail after a crash. |
| `configured` | Configure + listeners run once. Failed configure resets this so the next call retries. |
| `ignoreProgressUntil` / `seekAnchorSec` | After skip/seek, native still emits a few ticks from the *old* position. Drop ticks that are >3s away from the seek we just asked for. |
| `queueSwapInFlight` | `loadPlaylist` emits seek/progress *before* JS `session` has caught up. Listeners ignore those so we do not persist the new timeline onto the outgoing album. |
| `wantsPlaying` | **User intent**, not native `playWhenReady`. Error / album-end / pause must not auto-resume when we rebuild native. |
| `skipPauseRewind` | Offline stall and source-swap pauses are not user pauses — skip the 2s audiobook rewind. |
| `albumEnded` | Stopped at last track is intentional. Foreground restore must not rebuild (that would seek 0 and kill the replay icon). |
| `rewoundForThisPause` | Pause rewind runs once per pause. |
| `wasPlaying` | Detect the playing→paused edge for rewind. |

The mutex serializes every native mutation. Native is not re-entrant; overlapping `loadPlaylist` + `skipToNext` is how you get a dead player.

- `enqueue` — wait for the lock (used by `loadAlbum`, `seekBy`, `seekTo`, `setRate`).
- `fire` — fire-and-forget through the same lock. On throw, refresh native so the UI is not stuck on a lie.

---

## Configure once

`ensureConfigured` (845–863): notification permission if the wizard finished, `TrackPlayer.configure`, repeat off, attach listeners, AppState, NetInfo re-configure.

`nativePlayerConfig` packs extra flags into `androidNotificationIcon` as a `;`-separated token (`icon:…;skipOnError:…;remotePrimary:…;httpOverflow:…`) because `PlayerConfig` has no real fields for those. Native `applyConfigToken` parses it. Changing skip-on-error, remote-primary, or online/offline re-`configure`s.

`withNativeReady` (865–870) = configure + “if ExoPlayer died, rebuild from session” + then do the action. Service death / audio-focus stop leaves ExoPlayer `STATE_IDLE`; `play()` without prepare is a no-op. `isNativePlaybackDead` treats missing track, `not-playing`, or `stopped` as dead.

---

## JS status and persist

`currentStatus` maps `cachedNative` + `session` + `rate` + `lastError` through `statusFromNative`, then overlays `albumEnded`.

`statusFromNative` has a trap: if native’s current track id is **not** in this session, it is the *previous* album still reporting. It returns buffering idle rather than mapping by index (that used to write the other album’s seek onto this one).

`emit` writes Zustand and debounce-persists resume (1s, leading + trailing + maxWait — trailing-only would never fire if progress ticks keep resetting the timer).

`persistNow` cancels the debounce and writes immediately (pause, seek, track change, background). Also writes per-album rate when there is a session.

AppState: background/inactive → persist if native is still alive. Active → restore if dead, **unless** `albumEnded`.

---

## Loading an album (`loadIntoNative`)

This is the expensive path (`loadIntoNative`, 961). Order matters:

1. `queueSwapInFlight = true`, ignore progress for 2s, set `seekAnchorSec`.
2. If switching **albums**, persist the outgoing status first.
3. **Assign `session = frozen` before native load.** Stale ticks must not write the new timeline onto the old album id.
4. Snapshot `nativeSourceUrls` from the frozen urls.
5. Create playlist → add tracks → `loadPlaylist(id, startIndex)` — start index is passed **here**. Loading at 0 then `skipToIndex` still windows ExoPlayer from N.
6. Seek if `positionSec > 0`, apply that album’s saved rate, prune other native playlists.
7. `finally`: `queueSwapInFlight = false`.

`loadAlbum` on the public engine (1014–1034) has a shortcut: if the same album (same ids + urls, `snapshotsEqual`) is already loaded and native is alive, **do not rebuild**. Seek/skip in place and re-apply rate. Catalogue refresh with the same files must not tear down ExoPlayer. If native is dead, fall through to a full load.

---

## Listeners (the event storm)

Attached once via `attachNativePlayerListeners`. Progress/seek/state are dropped while `queueSwapInFlight`. Track-change is **not** dropped at the listener layer — the handler itself returns early if a swap is in flight.

### Track change

Lock-screen prev/next land here too; they never call `engine.previous/next`.

- Arm progress-ignore, clear `albumEnded`.
- Refresh + persist immediately (resume for the *new* track, not the old one).
- `reloadIfCurrentSourceStale` — safety net after a download: native already started this item; if the URL we last loaded ≠ `playableUrlFor`, rebuild at current position (or 0 if <1s in). Compare `nativeSourceUrls[index]`, not nitro’s `currentTrack.url`.

### Playback state

- `reason === "error"` → offline-stream vs generic error copy, refresh, maybe fallback a missing local file, clear `wantsPlaying` so restore does not auto-play.
- `reason === "end"` → Android: `wantsPlaying = false`, `albumEnded = true`, persist the last frame plus the **native** duration (native is stopped so the usual persist path skips). Do **not** write 0 — that looks like the last track never started. Replay uses `albumEnded` / `atEnd` to start at 0. Album/history “finished?” checks use the stored duration, not catalogue `durationSec` (those can disagree with the file). **iOS:** if this is not the last session track, treat it as a dead AV queue (preloaded `https` next-item failed offline). Reload the next `file:` and play; if the next track is not downloaded, show `offlineStreamError` and do **not** set `albumEnded`.
- `playing` → clear error.
- `buffering` while offline on a CDN url → stall after the buffer emptied. Show error, clear `wantsPlaying`. Do **not** JS-pause a healthy stream just because NetInfo flipped — that is only for native stall/error (`isOfflineStreamNow`).
- Then the playing→paused edge: if it looks like a user pause, rewind 2s once (`applyPauseRewind`). If it is an offline stall still “playing/buffering”, pause without rewind. Other pauses persist immediately.

### Progress

Ignore if native track id is not in session; ignore if still in the ignore window and >3s from `seekAnchorSec`; otherwise patch `cachedNative` and `emit` (debounced persist).

### Seek

Same session guard, then set the ignore window from the new position, persist immediately (user scrubbed).

Language change: `updateTracks` with new titles/artists (same urls). The native patch allows title refresh on the current item and the upcoming window (next 4). Theme change uses the same path for artwork URLs.

---

## Pause rewind

User pause (in-app, lock screen, sleep, Bluetooth) seeks back `PAUSE_REWIND_SEC` (2) so resume is not mid-word. Clamp at 0 — **do not** overflow to the previous track. Skip if native is already playing again, or if the delta is tiny. Arm the same ignore-progress window so the old position does not overwrite the rewind.

Skipped for: album end, errors, offline stall, and any path that sets `skipPauseRewind` (source swap, missing-file fallback).

---

## Live queue / downloads

Downloads must not restart the *currently playing* stream. Four layers:

1. **`withLocalUrlsPinnedCurrent`** — upcoming tracks get `file:` urls; the current track keeps the url it is already playing.

2. **`applyUpcomingSourceUpdates`** (`syncLiveQueueSources`, also called before in-app skip) — if playing/buffering, pin current, then `updateTracks` (**Android only**). Native **will not** change the current item’s URL via `updateTracks`. If paused and the current url changed, full `loadIntoNative` at the same position, then pause. That paused reload runs **after** the 2s pause-rewind (native paused listener), not from `engine.pause()`, and also when a download finishes **while already paused**. **iOS** returns before `updateTracks`; skip/end/`reloadIfCurrentSourceStale` still `loadIntoNative(withLocalUrls)`. After Android `updateTracks`, sync `nativeSourceUrls` to the playlist we sent.

3. **`reloadIfCurrentSourceStale`** — after native has already moved to the next item (auto-advance or lock-screen skip), rebuild if that item’s loaded url is stale.

4. **`maybeFallbackMissingLocal`** — file deleted by user/OS, or native still holding a deleted `file:` after `updateTracks`. If we still have a local file, leave it. If offline and no file, show error. Else reload with `withLocalUrls` (CDN fallback). **iOS:** if native still holds `https` and the file exists, reload onto the file (do not take the vanished-file early return).

`skipToResolvedIndex` is the in-app next/prev/skipTo path: if the *target* url differs from `nativeSourceUrls[index]`, full reload at that track from 0 (and play if `wantsPlaying`). Same-index next-on-last is a no-op rebuild-wise — just `updateTracks` then native skip.

Downloads notify through `live-queue.ts` (dynamic import) so downloads and playback do not import each other statically. iOS skips that notify while playing/buffering (mutex race with `play()`); idle completes still notify so a paused current track can swap to `file:`.

---

## ±10 overflow (`seekByOverflowing`)

In-app ±10. If −10 would go before 0 and there is a previous track, leftover time lands near the end of the previous track. If +10 would go past duration and there is a next track, leftover lands at the start of the next. First-track −10 / last-track +10 clamp.

If the neighbour’s url is stale vs `nativeSourceUrls`, reload that neighbour at the overflow position instead of skip+seek. Otherwise `applyUpcomingSourceUpdates` then skip+seek.

Lock-screen / notification ±10 when remote-primary is `"seek"` is **native** (`seekBackOverflowing` / `seekForwardOverflowing`). This JS path is for in-app buttons.

---

## Public engine methods

What screens actually hit via `store.ts`:

**`play`:** refuse CDN while offline. Set `wantsPlaying = true`, clear `albumEnded`. If parked at the last frame, `play()` is a no-op — rebuild from 0 first. Same if native is dead. Catch + retry rebuild. After play, if still not playing and native looks dead, rebuild again.

**`pause`:** `wantsPlaying = false`, native pause, persist immediately (rewind happens from the state listener).


**`next` / `skipTo`:** `skipToResolvedIndex` then persist.

**`previous`:** if position is past `SKIP_TO_PREVIOUS_THRESHOLD_SEC` (~2s), seek 0 on the **current** track (same as native skip-previous). Otherwise `skipToResolvedIndex` the previous index. Mixed `file:` / `https` used to skip a neighbour when in-app prev always aimed at the previous slot.

**`seekTo`:** clamp, arm ignore window, seek, **patch `cachedNative` immediately** because `getState()` can still return the pre-seek position (thumb would jump back).

**`setRate`:** clamp, native + MMKV per album.

**`subscribe` / `getStatus`:** Zustand. History recording lives in `store.ts` on album+track identity change, not here.

---

## Review order that matches the control flow

1. Closure flags (63–87) — keep this list open while you read the rest.
2. `loadIntoNative` (961) + `loadAlbum` shortcut (1014) — how a session becomes a native playlist.
3. `attachListeners` (250) — every native event you will debug later.
4. `applyUpcomingSourceUpdates` (685) / `reloadIfCurrentSourceStale` / `maybeFallbackMissingLocal` — download + missing-file.
5. `play` / restore / `isNativePlaybackDead` — process death and replay-at-end.
6. `seekByOverflowing` + `skipToResolvedIndex` — skip vs reload-because-url-changed.
