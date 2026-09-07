# Manual test plan

Device checklist for the Play-bound **preview APK** (`runtimeVersion` `1.0.3`). Metro / `expo start` does not enable OTA, Sentry native, or Firebase.

Install **this** APK. Uninstall the previous preview first. Android: set the app to **Unrestricted battery**.

Phase 6 Cloud sync and Phase 7 share/App Links **JS** are not in this binary. Native modules are linked; UI for those is a later OTA.

---

## 1. Install and launch

- [ ] APK installs; launcher icon and splash match the new art.
- [ ] Cold start: native splash is brief, then a **JS spinner** (“Loading…”). No Google account picker, no sign-in sheet, no Firestore prompt.
- [ ] If an OTA is waiting and nothing is playing: spinner, then **Update ready** dialog (OK only), then “Updating…”, then a possible short blank, then the app again. (except playing check)
- [ ] Status-bar / media notification small icon is the Asset Studio glyph (`ਗੁ`), not the old chevron.
- [ ] Catalogue loads from Pages (not mock). Home lists sehaj paath by scripture, then reciter collections. No Gursikh portraits.

**Fresh install (clear app data or new device):**

- [ ] Three-step wizard: language → Simple mode → notifications, then the system permission prompt.
- [ ] After wizard, first Home shows the Fateh intro. **OK only** (no Email / Not now). Dismiss once; it must not return.
- [ ] Intro copy mentions Settings for later email.

**Existing user (upgrade / already past wizard):**

- [ ] No wizard.
- [ ] Intro at most once (`hasSeenIntroFeedback`).

---



## 2. Chrome, type, and tap

- [ ] Default chrome readable at arm’s length. Simple mode is still larger (tabs, rows, Now Playing).
- [ ] Android ripple and iOS pressed opacity on Home rows, tabs, Now Playing, Settings tiles.
- [ ] Settings labels are words, not a raw email address as the only text.

---



## 3. Playback and network

Stream a long track. Keep the notification shade / lock screen visible.

- [ ] Play, pause, prev, next, ±10 in-app. Lock screen / notification follow **Lock screen and headset buttons** (default ±10).
- [ ] Album ends on the last track; does not continue into another album.
- [ ] Pause rewinds ~2s (in-app, lock screen, Bluetooth). End of album / end of track must not rewind-loop.
- [ ] Wi‑Fi ↔ cellular while streaming: audio keeps going.
- [ ] Airplane ~4s+: stream may keep playing from the native buffer; do not expect a JS pause on a brief drop.
- [ ] Incoming call: pause, then auto-resume when the call ends.
- [ ] Keep screen on (Settings / overflow) while playing or buffering.
- [ ] Play a **late** track from Home → Now Playing → album button → that row is on screen (`?trackId=`). Playback must **not** restart from 0.

---



## 4. Downloads and offline

- [ ] Settings **Download on Wi-Fi only** default on: cellular download refused, points to Settings.
- [ ] Wi-Fi only **off**: warn before downloading on mobile data.
- [ ] Download all (album) and one track. One progress notification per album batch; separate notification per single-track download.
- [ ] ++Downloaded icon on track rows++; collection downloaded icon when every track is on disk.
- [ ] Airplane + downloaded album: local play works. Undownloaded rows muted; play does not start a stream.
- [ ] Read along disabled while offline.
- [ ] Cannot delete the file of the **playing or buffering** track. Paused current-file delete is OK.
- [ ] Offline banner on wizard, tabs, and modals; does not cover content.

---



## 5. Paath helpers

- [ ] Bookmark from Now Playing (optional note). Toast **Bookmark saved.** Tap a bookmark: that track **plays**. From Now Playing’s bookmark list, toast **Playing from bookmark.**
- [ ] Album Bookmarks opens that album’s list even when nothing is playing.
- [ ] History: newest row **Playing** while that track is playing/buffering (opens Now Playing). Paused mid-track: resume time, plays from per-album resume. Older / ended rows play from 0.
- [ ] Sleep timer: when on, accent fill, distinct icon, remaining time. Options: this track, rest of album, N tracks, hours+minutes.
- [ ] Read along opens STTM when `sttmCoSlug` + `startAng` exist; hidden otherwise; disabled offline.

---



## 6. Settings and feedback

- [ ] **Give feedback** opens mail to `contact@opensikhapps.com` with app version and update id. If no mail app: address + version copied.
- [ ] Theme, language, Simple mode match wizard values.
- [ ] **Check for update** (see §8). need to add snack bar

---



## 7. Crash reporting

Step-by-step: [crash-reporting-test.md](./crash-reporting-test.md).

- [ ] Force a **JS** `ErrorBoundary` once (temporary throw). Dialog: Send report / Don’t send.
- [ ] **Send** → event in Sentry. **Don’t send** → no that event; app recovers.
- [ ] Native crash (if you test it): auto-send; **next successful launch** shows a modal (report sent, Email / OK). **no** Send/Don’t send dialog.
- [ ] Remove any debug throw before testers keep the APK.

---



## 8. OTA (after this APK is installed)

OTA is JS + assets only. `runtimeVersion` must stay `1.0.3` until the next native bump. Icons, Firebase, Sentry native, and `expo-updates` itself cannot OTA.

1. Publish: `npm run ota:publish` (channel `preview`, Worker `https://updatesgurbaniaudioplayer.opensikhapps.com`).
2. On the **same** installed APK:

- [ ] Idle (nothing playing, no downloads): **cold start** → Update ready (OK) → apply. 
- [ ] **Settings → Check for update** applies **without** that heads-up (overlay only).
- [ ] While **streaming**: confirm copy (“This stops playback and downloads… screen may go blank…”), Update → audio stops, app reloads, resume restored.
- [ ] While a **download** runs: same confirm; in-flight downloads cancelled; resume restored after reload.
- [ ] Not now leaves playback/downloads running.
- [ ] An APK with a different `runtimeVersion` must **not** fetch it.

---



## 9. Native stubs (this APK)

- [ ] `google-services.json` was present for the build; cold start still has no Google / Firebase UI.
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

| What you are testing | How |
|---|---|
| Metro / `expo start` | Restart Metro after `.env` change. Not an APK test. |
| Sideload **preview** APK (`runtimeVersion` `1.0.3`) | `OTA_ALLOW_NATIVE_CHANGE=1 npm run ota:publish` then cold start or Settings → Check for update. Fingerprint will complain because `eas.json` changed; the override is correct for this env-only edit. |
| Play / **production** AAB | `OTA_ALLOW_NATIVE_CHANGE=1 OTA_CHANNEL=production npm run ota:publish` — only when you want store users on the new host. |

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

- [ ] Wizard + Settings locale `pa`: chrome is Punjabi, Gurmukhi font, no leftover English on primary controls.