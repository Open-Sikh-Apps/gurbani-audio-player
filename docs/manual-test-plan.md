# Manual test plan

Device checklist for the Play-bound **preview APK** (`runtimeVersion` `1.0.6`). Metro / `expo start` does not enable OTA, Sentry native, or Firebase.

Install **this** APK. Uninstall the previous preview first. Android: set the app to **Unrestricted battery**.

Phase 6 Cloud sync and Phase 7 share/App Links **JS** are not in this binary. Native modules are linked; UI for those is a later OTA.

---

## 1. Install and launch

- [x] APK installs; launcher icon and splash match the new art.
- [x] Cold start: native splash is brief, then a **JS spinner** (app title, **Loading…**, **Please wait**). No Google account picker, no sign-in sheet, no Firestore prompt.
- [x] If an OTA is waiting and nothing is playing: spinner, then **Update ready** dialog (OK only), then “Updating…”, then a possible short blank, then the app again. (except playing check). **First install** (wizard not done) skips Update ready — overlay only.
- [x] Status-bar / media notification small icon is the Asset Studio glyph (`ਗੁ`), not the old chevron.
- [x] Catalogue loads from Pages (not mock). Home lists sehaj paath by scripture, then reciter collections. No Gursikh portraits.

**Fresh install (clear app data or new device):**

- [x] Three-step wizard: language → Simple mode → notifications, then the system permission prompt.
- [x] After wizard, first Home shows the Fateh intro. **OK only** (no Email / Not now). Dismiss once; it must not return.
- [x] Intro copy mentions Settings for later email.

**Existing user (upgrade / already past wizard):**

- [x] No wizard.
- [x] Intro at most once (`hasSeenIntroFeedback`).

---



## 2. Chrome, type, and tap

- [x] Default chrome readable at arm’s length. Simple mode is still larger (tabs, rows, Now Playing).
- [x] Android ripple and iOS pressed opacity on Home rows, tabs, Now Playing, Settings tiles.
- [x] Settings labels are words, not a raw email address as the only text.

---



## 3. Playback and network

Stream a long track. Keep the notification shade / lock screen visible.

- [x] Play, pause, prev, next, ±10 in-app. In-app **Previous** after ~2s restarts the current track (same as lock-screen skip-previous). Lock screen / notification follow **Lock screen and headset buttons** (default ±10).
- [x] Album ends on the last track; does not continue into another album.
- [x] Pause rewinds ~2s (in-app, lock screen, Bluetooth). End of album / end of track must not rewind-loop.
- [x] Wi‑Fi ↔ cellular while streaming: audio keeps going.
- [x] Airplane ~4s+: stream may keep playing from the native buffer; do not expect a JS pause on a brief drop.
- [x] Incoming call: pause, then auto-resume when the call ends.
- [x] Keep screen on (Settings / overflow) while playing or buffering.
- [x] Play a **late** track from Home → Now Playing → album button → that row is on screen (`?trackId=`). Playback must **not** restart from 0.
- [ ] **Android:** tap the expanded media notification (Now Playing). App comes to the front **without** the JS splash or a second catalogue fetch. Playback / mini-player stay. Compact shade / lock-screen controls often will not open Now Playing.

**Android recents, Close all**

Regression (must not break):

- [ ] **Home** (not Recents): play, press Home, screen off. Audio **keeps going**. Notification stays. Opening the app does not restart the track from 0.
- [ ] Incoming **call** while playing: pause, then auto-resume when the call ends (audio-focus, not our new persist).
- [ ] Pause from the **shade**, then Home. Stays paused. Opening the app does not autoplay.
- [ ] Play to **album end**. Opening the app does not autoplay. Replay from the mini-player still works.
- [ ] Shade **±10 / prev / next** still follow **Lock screen and headset buttons**. Expanded notification tap still opens Now Playing.

User stop:

- [ ] Play, swipe the app from **Recents**. Audio **stops**. Notification goes away. Home icon: paused mini-player, not autoplay.
- [ ] Play, then **Close all**. Audio **stops** and does not come back with the screen off. (ColorOS may leave a stale media notification; audio must still be stopped. Opening the home icon: paused, not autoplay.)

---



## 4. Downloads and offline

- [x] Settings **Download on Wi-Fi only** default on: cellular download refused, points to Settings.
- [x] Wi-Fi only **off**: warn before downloading on mobile data.
- [x] Download all (album) and one track. One progress notification per album batch; separate notification per single-track download.
- [x] ++Downloaded icon on track rows++; collection downloaded icon when every track is on disk.
- [x] Airplane + downloaded album: local play works. Undownloaded rows muted; play does not start a stream.
- [ ] **iOS only (not Android):** start a batch on an album that is not fully on disk, then play a streaming track that is **not** among the last few undownloaded rows. In-app count moves one file at a time (iOS is always 1-wide). Shade says **Downloading…** (not a stuck 0 of N). Scrubber, Back, and in-app pause stay live past ~20s. Toast **Downloads paused while playing** only if the leftover rows are the current track plus the next 3. Pause audio: still 1-wide; shade **count** resumes. Android still 3-wide, including while playing.
- [ ] **iOS:** same setup, lock the device while **playing**. Unheld leftover rows should keep downloading in URLSession (one at a time, not only the single JS pump job). Current + next 3 wait. Unlock, UI still live. Shade still **Downloading…** until pause. Force-quit mid-batch while playing, reopen: leftover queued/downloading rows resume (kill cancels URLSession — in-flight may restart from 0). Finished tracks stay. Must not freeze. Kill + wifi-on from Control Center must not crash.
- [ ] **iOS:** pause in-app, lock, then **play from the lock screen**. UI must stay live after unlock (always-1 so this cannot go 3-wide next to AVPlayer). Window rows may have been dumped while paused — skip/next should not freeze.

**iOS play + download soak (this change)**

Use a large album still on the CDN. Reload JS. Do not test this on Android.

1. Download all. Confirm the album notice shows a **count** (`N of M parts`) and rows go **one at a time** (not three).
2. Play a **mid** streaming track (not among the last few undownloaded). Stay on Now Playing ≥20s. Scrubber / Back / pause work. Shade becomes **Downloading…** (not a frozen count). Toast **Downloads paused while playing** only if leftovers are current + next 3.
3. Lock **while playing** for several minutes. Unlock: many unheld rows completed; current + next 3 still queued; UI live. Skip to a finished unheld row: downloaded icon is OK.
4. Pause (in-app or lock screen, then unlock if JS was asleep). Shade **count** returns. Still one file at a time. Window rows may start.
5. Pause in-app → lock → wait ~30s → **play from Control Center / lock screen** → unlock. UI live, audio playing, downloads still 1-wide. Must not freeze.
6. Mid-batch, playing: swipe-kill, reopen. Finished files stay; leftover resumes; in-flight may restart from 0. Must not freeze.
7. Download all → play → wifi off → kill → reopen → wifi on from Control Center. Must not crash. Album continues.

Accepted: pause a stream whose file is already on disk — Now Playing may keep streaming that item until skip/next.
- [ ] **iOS (accepted):** pause a streaming track whose file already finished downloading — Now Playing may still show/stream that item until skip/next. Do not treat as a blocker (`updateTracks` on pause hung the UI).
- [x] Read along disabled while offline.
- [x] Cannot delete the file of the **playing or buffering** track. Paused current-file delete is OK.
- [x] Offline banner on wizard, tabs, and modals; does not cover content. **iOS:** Now Playing / Settings / Bookmarks full-screen modals have their **own** banner (root chrome does not cover them). Android still uses the root banner only.

---



## 5. Paath helpers

- [x] Bookmark from Now Playing (optional note). Toast **Bookmark saved.** Tap a bookmark: that track **plays**. From Now Playing’s bookmark list, toast **Playing from bookmark.**
- [x] Album Bookmarks opens that album’s list even when nothing is playing.
- [x] History: newest row **Playing** while that track is playing/buffering (opens Now Playing). Paused mid-track: resume time, plays from per-album resume. Older / ended rows play from 0.
- [x] Sleep timer: when on, accent fill, distinct icon, remaining time. Options: this track, rest of album, N tracks, hours+minutes.
- [x] Read along opens STTM when `sttmCoSlug` + `startAng` exist; hidden otherwise; disabled offline.

---



## 6. Settings and feedback

- [x] **Give feedback** opens mail to `contact@opensikhapps.com` with app version and update id. If no mail app: address + version copied.
- [x] Theme, language, Simple mode match wizard values.
- [x] **Check for update** (see §8). Settings uses Alert dialogs (none / store / busy / failed) — not a snack bar.

---



## 7. Crash reporting

Step-by-step: [crash-reporting-test.md](./crash-reporting-test.md).

- [x] Force a **JS** `ErrorBoundary` once (temporary throw). Dialog: Send report / Don’t send.
- [x] **Send** → event in Sentry. **Don’t send** → no that event; app recovers.
- [x] Native crash (if you test it): auto-send; **next successful launch** shows a modal (report sent, Email / OK). **no** Send/Don’t send dialog.
- [x] Remove any debug throw before testers keep the APK.

---



## 8. OTA (after this APK is installed)

OTA is JS + assets only. `runtimeVersion` must stay `1.0.6` until the next native bump. Icons, Firebase, Sentry native, and `expo-updates` itself cannot OTA.

1. Publish: `npm run ota:publish` (channel `preview`, Worker `https://updatesgurbaniaudioplayer.opensikhapps.com`).
2. On the **same** installed APK:

- [x] Idle (nothing playing, no downloads): **cold start** → Update ready (OK) → apply. First install (wizard not done) skips that heads-up. 
- [x] **Settings → Check for update** applies **without** that heads-up (overlay only).
- [x] While **streaming**: confirm copy (“This stops playback and downloads… screen may go blank…”), Update → audio stops, app reloads, resume restored.
- [x] While a **download** runs: same confirm; in-flight downloads cancelled; resume restored after reload.
- [x] Not now leaves playback/downloads running.
- [x] An APK with a different `runtimeVersion` must **not** fetch it.

---



## 9. Native stubs (this APK)

- [x] `google-services.json` was present for the build; cold start still has no Google / Firebase UI.
- [ ] SHA-1 / SHA-256 can wait until Phase 6 Sign in exists. No sign-in tile in this JS.
- [ ] Share sheet and HTTPS App Links wait for Phase 7 JS. Host is `gurbaniaudioplayer.opensikhapps.com` (`/a/…`). Domain `assetlinks.json` can wait.

---



## 10. Custom catalogue host (this JS)

`eas.json` now inlines `https://cataloguegurbaniaudioplayer.opensikhapps.com`. That URL is **not** in an already-installed APK/AAB until the next OTA (or a new binary). Metro uses `.env` only.

**Desk (once):**

```bash
curl -sI "https://cataloguegurbaniaudioplayer.opensikhapps.com/catalogue.version.json"
curl -s "https://cataloguegurbaniaudioplayer.opensikhapps.com/catalogue.version.json"
```

Expect `200`, TLS OK, JSON `{"version": …}` matching `pages.dev`.

**Get the URL onto the phone**


| What you are testing                                | How                                                                                                                                                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metro / `expo start`                                | Restart Metro after `.env` change. Not an APK test.                                                                                                                                                   |
| Sideload **preview** APK (`runtimeVersion` `1.0.6`) | `OTA_ALLOW_NATIVE_CHANGE=1 npm run ota:publish` then cold start or Settings → Check for update. Fingerprint will complain because `eas.json` changed; the override is correct for this env-only edit. |
| Play / **production** AAB                           | `OTA_ALLOW_NATIVE_CHANGE=1 OTA_CHANNEL=production npm run ota:publish` — only when you want store users on the new host.                                                                              |


Do not rebuild Android just for this URL.

**On the device (after that JS is running):**

- [ ] Cold start: Home lists sehaj paath / reciter collections (not mock). No Google picker.
- [ ] Home overflow → **Refresh catalogue**: toast **Updating…**, list does not jump to the top.
- [ ] Pull-to-refresh: spinner only (no **Updating…** toast).
- [ ] Optional proof of host: Proxyman/Charles filter `cataloguegurbaniaudioplayer.opensikhapps.com` on `catalogue.version.json` / `catalogue.json`. Or Cloudflare analytics for that hostname. Blocking `*.pages.dev` must **not** break refresh.
- [ ] Optional live bump: bump `catalogue.version.json` + `catalogue.json` in the catalogue repo, wait for CI, pull-to-refresh, new row/title appears.
- [ ] Refresh **error**: stay NetInfo-online but break the **custom** host (not airplane). Toast **Could not refresh the catalogue. Showing the last saved copy.** Home must not blank.
- [ ] Airplane: Home still shows the last saved catalogue; no refresh-error toast.

**Android uninstall (already OK if you saw no picker):**

- [ ] Uninstall → reinstall the same APK (no OTA required for this bit). Wizard again. Cold start still has no Google / Firebase UI.

**iOS only (needs a new binary, not OTA):** the backup-exclusion plugin and Keychain wipe are native. After a new iOS prebuild/install:

- [ ] Delete the app → reinstall that binary. Wizard runs. No Google picker on launch.
- [ ] After finishing the wizard once, delete+reinstall again: wizard again (MMKV gone); still no picker.

Crash last-run (system **Alert**, not a custom Modal): [crash-reporting-test.md](./crash-reporting-test.md) §B. Skip if you already passed §7 on this APK.

---



## Punjabi pass

- [x] Wizard + Settings locale `pa`: chrome is Punjabi, Gurmukhi font, no leftover English on primary controls.