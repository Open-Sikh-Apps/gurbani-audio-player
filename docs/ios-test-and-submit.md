# iOS test and App Store submit

Waheguru Ji Ka Khalsa, Waheguru Ji Ki Fateh.

How to soak the app on an iPad, then use a relative’s iPhone only for the few things an iPad cannot prove, then submit to App Review.

Play is already submitted. This path is **local EAS builds only** — same as Android. Do not run `eas build` without `--local`, and do not use `npx testflight` (that compiles in Expo’s cloud).

Device checklist for behaviour is still [manual-test-plan.md](./manual-test-plan.md). This file is the **order of operations** for iOS hardware, signing, TestFlight, and the store listing.

---



## Paid Apple Developer Program — delay it

You do **not** need the $99/year membership to do meaningful testing on this Mac and this iPad.

A **free Apple Account** in Xcode (Personal Team) is enough to:

- Run the app in the **Simulator**
- Install a **development client on the iPad over USB** (`npm run ios`)
- Exercise launch, wizard, catalogue, playback, downloads, offline, lock screen, Control Center, theme, language, Simple mode, bookmarks, History, sleep timer, share sheet

That install **expires after 7 days**. Rebuild and reinstall when it dies. Personal Team also caps you at 3 devices and 3 apps per device. Fine for occasional work: plug in, `npm run ios`, test, unplug.

The paid program is required only when you need **distribution**:


| Need                                           | Free Apple Account          | Paid Developer Program       |
| ---------------------------------------------- | --------------------------- | ---------------------------- |
| Simulator                                      | Yes                         | —                            |
| USB install on *your* iPad                     | Yes (7-day expiry)          | Yes (year-long dev profiles) |
| Background audio, downloads, Google URL scheme | Yes                         | Yes                          |
| Universal Links (`associatedDomains`)          | No — capability not allowed | Yes                          |
| TestFlight (iPad or relative’s iPhone)         | No                          | Yes                          |
| Store IPA / App Store Connect / App Review     | No                          | Yes                          |


Enrol when the iPad USB soak is clean and you are ready to make a TestFlight IPA in the next few days. Approval is often 24–48 hours, so start the form then — not months earlier, and not the night you want to submit.

If `npm run ios` fails signing because of Associated Domains (this app declares `applinks:gurbaniaudioplayer.opensikhapps.com` for store/TestFlight), that entitlement is the usual culprit on a Personal Team. USB `APP_VARIANT=development` already **omits** `associatedDomains` in `app.config.ts` — do not strip it by hand. Universal Links wait until the paid binary. Do not spend a year of membership just to prove HTTPS links.

---



## Hardware


| Device                                       | Role                                                                                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| This Mac                                     | Xcode 26.4+, Simulator, USB install to the iPad. Later: local store IPA.                                                                                                         |
| iPad (A16), iPadOS 26.6.1, model `MD4H4HN/A` | Primary physical tester. 11-inch Wi‑Fi, India region. USB first (free); TestFlight later (paid).                                                                                 |
| Relative's iPhone                            | **Last, and paid.** Cellular, incoming calls, Bluetooth headset, real compact Control Center / lock screen. TestFlight only — after the iPad store-shaped build is already good. |


The iPad cannot produce App Store screenshot sizes (Apple wants 6.9" iPhone and 13" iPad). Those come from **Simulator on this Mac**, not from the relative.

Apple reviewers almost always open the app on an iPhone. Simulator covers layout; the relative’s phone covers radio and call behaviour.

---



## Order (do not skip ahead)

**Free (no yearly subscription)**

1. Xcode + free Apple Account in Xcode (Personal Team). Not the paid program.
2. Firebase / Google iOS client + `GoogleService-Info.plist` on disk (needed to compile; unrelated to Apple’s $99).
3. **Simulator** — iPhone compact layout whenever you like.
4. **USB development client on the iPad** — this is the real soak. Walk [manual-test-plan.md](./manual-test-plan.md) here. Rebuild if the 7-day profile expires.
5. iPhone **Simulator** screenshots can be captured in this phase too (store upload waits until you have App Store Connect).

**Paid (enrol only when the next steps are imminent)**

1. Apple Developer Program + App Store Connect app record.
2. Local distribution cert + App Store profile in `credentials.json`. Bump `ios.buildNumber` for each IPA (`usesNonExemptEncryption` is already set).
3. Local **production IPA** → **TestFlight on the iPad only**. Confirm the store-signed binary (Universal Links, OTA, delete+reinstall).
4. App Store Connect listing (description, privacy, 6.9" + 13" shots).
5. **Then** invite the relative to the **same** TestFlight build. iPhone-only checks.
6. Same build → Submit for App Review.

Do not send the relative a TestFlight invite the moment the first IPA lands. If that iPad build is wrong, you will make him install twice.

---



## 1. Toolchain (free)

1. Install **Xcode 26.4 or newer** (Expo SDK 57). Open it once, accept the license, install extra components.
2. Xcode → **Settings → Accounts** → add your **free** Apple Account. You should see **Personal Team**. That is enough for USB and Simulator.
3. Confirm:

```bash
xcodebuild -version          # 26.4+
xcode-select -p              # /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
pod --version                # brew install cocoapods if missing
eas --version
eas login                    # Expo account cingh-jasdeep (not Apple’s $99)
```

Skip App Store Connect and developer.apple.com/programs until section 6.

---



## 2. Firebase / Google (before the first native iOS compile)

`app.config.ts` expects `./GoogleService-Info.plist` for store/TestFlight and `./GoogleService-Info-dev.plist` for USB `APP_VARIANT=development` (both gitignored, same idea as `google-services.json` / `google-services-dev.json`). Needed whether or not you have paid Apple.

1. Firebase Console → same project as Android → **Add app → iOS**, bundle ID `com.opensikhapps.gurbaniaudioplayer`. Drop the plist in the project root.
2. Google Cloud Console → OAuth client of type **iOS** with that bundle ID.
3. Confirm the plist has `REVERSED_CLIENT_ID` (URL scheme for Google Sign-in).

Cloud sync is Settings-only. App Review notes (later): the app is fully usable **without** signing in. Do not invent a Google password for reviewers.

---



## 3. Simulator (free, any time)

Xcode Simulator: **iPhone 16 Pro Max** or **iPhone 17 Pro Max** (6.9" class), and later a **13-inch iPad Pro** for store shots.

```bash
npm run ios
```

Pick a simulator if the iPad is not plugged in. This is a **dev** client — good for clipped chrome, wizard, Home, Now Playing, tabs. Do not treat Simulator audio, background, or downloads as proof. Those wait for the physical iPad.

Layout pass: compact width, home-indicator overlap. **File → Save Screen** (or Cmd-S) when you want store-sized PNG later.

Required App Store media (upload only after section 6; capture whenever):


| Slot        | Example pixels                       | Source                                              |
| ----------- | ------------------------------------ | --------------------------------------------------- |
| iPhone 6.9" | 1320×2868 (or 1290×2796 / 1260×2736) | 6.9" iPhone Simulator                               |
| iPad 13"    | 2064×2752 (or 2048×2732)             | **13-inch iPad Pro Simulator**, not the 11-inch A16 |


JPEG/PNG, no alpha, portrait. 1–10 per size. 1024×1024 icon: no alpha, no rounded-rect overlay.

---



## 4. USB development client — iPad only (free Personal Team)

This is the main test loop. Bundle ID is `com.opensikhapps.gurbaniaudioplayer.dev` (`APP_VARIANT=development`). Not what Apple reviews.

1. USB-C: iPad → Mac. Trust this computer on the iPad.
2. Xcode → **Window → Devices and Simulators** — the iPad should appear.
3. First time: on the iPad, **Settings → General → VPN & Device Management** (or Device Management) → trust your Apple Account’s developer app.
4. From the project:

```bash
npm run ios
```

Pick the **iPad**. First run prebuilds `ios/`, `pod install`, compiles. Signing should be Automatic / Personal Team.

1. Metro stays up. Reload JS without a native rebuild unless plugins / native deps changed.
2. After ~7 days the app will fail to launch (“integrity could not be verified” / expired profile). Plug in and `npm run ios` again. That is expected on a free account.

Walk **all** of [manual-test-plan.md](./manual-test-plan.md) that an 11-inch Wi‑Fi iPad can do: launch, wizard, catalogue, play, lock screen, downloads, airplane, bookmarks, History, sleep timer, settings, crash reporting if you care. This *is* the thorough iPad pass. A later TestFlight build is only to prove **store signing**, Universal Links, and production OTA — not to rediscover basic bugs.

Skip on this USB build:

- Universal Links (Personal Team cannot ship Associated Domains)
- Production OTA channel (`preview` vs `production`, store-signed `runtimeVersion` binary)
- Cellular download policy (Wi‑Fi iPad)
- Incoming phone call (no cellular radio)

Do **not** install this 7-day dev client on the relative’s iPhone. Personal Team device slots are scarce, and he would need the Mac.

---



## 5. iPad soak checklist (USB, then again on TestFlight)

Run this on the USB build now. Re-run the store-signed subset after section 8.

1. **Install / identity**

- [ ] x(dark mode icon needs Testflight) Launcher icon and splash (light + dark).
- [x] Cold start: native splash, then JS spinner (app title, **Loading…**, **Please wait**). No Google / Firebase picker.
- [x] Catalogue from Pages. Home is sehaj paath by scripture, then reciter collections.

**Delete + reinstall** (native Keychain / backup exclusion — not OTA)

- [x] Delete the app → reinstall. Wizard runs. No picker on launch.
- [x] Finish the wizard once, delete + reinstall again: wizard again (MMKV gone); still no picker.

On USB you reinstall with `npm run ios`. On TestFlight, delete and install that same TestFlight build.

**Playback**

- [x] Play, pause, prev, next, ±10 in-app. In-app **Previous** after ~2s restarts the current track.
- [x] (fixed) Lock screen + Control Center follow **Lock screen and headset buttons**. When primary is ±10, iOS shows numbered skip-interval commands **and** keeps next/prev enabled so a headset still seeks ±10 — see [NITRO_PLAYER_PATCH.md](./NITRO_PLAYER_PATCH.md).
- [x] Background: lock the iPad, audio keeps going; unlock, position is sane.
- [x] Album ends on the last track; does not continue into another album.
- [x] Pause rewinds ~2s. x End of album / y end of track must not rewind-loop.
- [x] (need production build/Testflight) Keep screen on while playing or buffering.
- [ ] Wi‑Fi toggle / airplane: downloaded album plays offline; undownloaded rows do not start a stream.

This iPad is **Wi‑Fi only**, so do not try to prove cellular-download policy here.

**Downloads, helpers, settings**

- [x] Download all / one track; progress notifications; downloaded icons.
- [x] **Play while a batch is running (iOS):** start Download all on an album still on CDN, play a streaming row that is not among the last few undownloaded tracks. Stay on Now Playing ≥20s: scrubber/Back/pause work. Shade **Downloading…** not a stuck count. iOS downloads stay **1-wide** even when paused. Lock while playing: unheld leftover continues. Pause → lock → play from lock screen: UI live after unlock. Force-quit while playing, reopen: leftovers continue. Kill + wifi-on must not crash. Full steps: [manual-test-plan.md](./manual-test-plan.md) §4.
- [x] y Bookmarks,  y History,  y sleep timer, y read along (disabled offline).
- [x] Theme, language, Simple mode.
- [x] Give feedback mail / copy fallback.

**Share / Universal Links** (TestFlight / paid only)

- [ ] Native share sheet (USB can do the sheet; HTTPS applinks wait for paid).
- [ ] Opening `https://gurbaniaudioplayer.opensikhapps.com/a/…` lands on that album under Home (Back has a screen under the link). `/t/{trackId}` and `?trackId=` **scroll** to the row — they do **not** auto-play. Needs Associated Domains + a valid `apple-app-site-association` on that host.

**OTA** (TestFlight production binary, after a publish to `production/ios/{runtimeVersion}/`)

- [ ] Idle cold start / Settings → Check for update, per [ota-updates.md](./ota-updates.md).
- [ ] Confirm while streaming / while a download runs.

Fix USB failures **before** you pay. TestFlight is for the leftover store-only rows, not a second full debug cycle.

---



## 6. Enrol in the Apple Developer Program

Do this when section 5 is clean and you intend to upload an IPA soon.

1. Enrol at [developer.apple.com/programs](https://developer.apple.com/programs). **Individual** is the simpler path. Approval is often 24–48 hours.
2. [App Store Connect](https://appstoreconnect.apple.com) → **Apps → + → New App**:
  - Platform: iOS
  - Name: must be unique on Apple (Play’s name may already be taken)
  - Bundle ID: `**com.opensikhapps.gurbaniaudioplayer**` (create the App ID in the Developer portal first if it is not listed)
  - SKU: e.g. `gurbani-audio-player`
3. Developer portal → **Identifiers** → that App ID:
  - **Associated Domains** (`applinks:gurbaniaudioplayer.opensikhapps.com`)
  - Background audio is already in `app.json` (`UIBackgroundModes: audio`)
  - Push is not required if notify-kit is **local** download progress only

The relative’s Apple ID is not needed until section 10.

---



## 7. Local store signing and one-time app config

`eas.json` has `"credentialsSource": "local"`. `credentials.json.example` is Android-only today.

Need:

- Apple **Distribution** certificate (`.p12` + password)
- **App Store** provisioning profile (`.mobileprovision`) for `com.opensikhapps.gurbaniaudioplayer`

On this Mac:

```bash
eas credentials --platform ios
```

Pick the **production** profile. Create the cert and App Store profile, then **download** them onto disk.

Extend `credentials.json` (never commit it):

```json
{
  "android": { },
  "ios": {
    "provisioningProfilePath": "credentials/ios/profile.mobileprovision",
    "distributionCertificate": {
      "path": "credentials/ios/dist.p12",
      "password": "the-p12-password"
    }
  }
}
```

`.gitignore` already covers `credentials.json`, `credentials/`, `*.p12`, and `*.mobileprovision`. Back them up off-repo like the Play upload keystore.

TestFlight / store use the **App Store** profile, not a device UDID list. The relative’s UDID is never required.

Already in `app.json` (bump by hand for every new IPA):

1. `ios.buildNumber` is `"3"` today. Independent of Android `versionCode` (`5` today). `autoIncrement` is off.
2. `ios.config.usesNonExemptEncryption` is `false` (ordinary HTTPS, no custom crypto) so TestFlight skips “Missing Compliance.”
3. Keep `runtimeVersion` at the shipping Android value (`1.0.6` in `app.json` now). iOS OTA lives in `production/ios/{runtimeVersion}/`. Bumping the top-level `runtimeVersion` for an iOS-only first binary would make Play users miss default Android OTAs. See [ota-updates.md](./ota-updates.md).
4. Confirm `GoogleService-Info.plist` is on disk before `eas build`. USB `.dev` already omits `associatedDomains`; production IPA keeps `applinks:gurbaniaudioplayer.opensikhapps.com`.

---



## 8. Production IPA and TestFlight — iPad only

Store-like binary. Catalogue URLs come from `eas.json` production env. Mock catalogue is forbidden (`app.config.ts` throws).

```bash
unset APP_VARIANT
npm run build:ios:production
```

(`package.json` `build:ios:production` is `eas build --profile production --platform ios --local --output ./build-ios.ipa`. `.gitignore` already ignores `build-ios.ipa`.)

First iOS local build is slow. Then upload (compile already happened on this Mac):

```bash
eas submit --platform ios --path ./build-ios.ipa --profile production
```

Or drag the IPA onto **Transporter** / Xcode Organizer if you want the Play-style manual upload. `eas.json` has no `submit` block yet; first `eas submit` asks for Apple ID. Use an [app-specific password](https://appleid.apple.com). After the app exists, `ascAppId` (numeric Apple ID on App Information) can go under `submit.production.ios`.

Wait for **Finished Processing** (often 10–30 minutes; first build can be longer). If it sits on Missing Compliance, answer encryption in App Store Connect or set `usesNonExemptEncryption` and rebuild.

App Store Connect → app → **TestFlight**:

1. Create an **Internal Testing** group.
2. Add **your** Apple ID (the one signed into the iPad). Leave the relative out.
3. On the iPad: uninstall the USB dev client, install **TestFlight** from the App Store, accept the invite, install **Gurbani audio player**.

Internal testers get the build as soon as processing finishes. Skip **External** testing (Beta App Review) unless you want people outside the team.

TestFlight builds expire after 90 days.

Re-run section 5’s **store-only** rows (Universal Links, production OTA, delete+reinstall of *this* IPA). A short playback/download smoke is enough if the USB soak was recent.

Fix failures, bump `buildNumber`, new TestFlight, iPad again. Still do not invite the relative.

---



## 9. App Store Connect listing

Fill this while the iPad TestFlight soak runs. Upload the Simulator screenshots from section 3.

- Description, keywords, support URL, **privacy policy URL** (reuse Play’s)
- Category (Music or Reference is typical)
- Age rating questionnaire
- Privacy Nutrition Labels: crash reporting (Sentry); optional account (Google) if that JS is in the binary. No ATT / tracking if you are not advertising
- Review notes: optional Google sign-in in Settings → Cloud sync; app works signed out; point at a sehaj paath album
- Guideline 4.8 (Sign in with Apple): usually for a **primary** social login. This app does not gate playback. Say that in the notes. Add Sign in with Apple only if a reviewer requires it
- Content rights: Gurbani Sewa audio, if they ask

Do **not** click Submit for Review until section 10’s iPhone-only checks pass, unless you are willing to ship without cellular / call proof.

---



## 10. relative’s iPhone — TestFlight, as late as possible

Only after:

- Paid membership is active
- The iPad TestFlight build has a clean soak (section 8)
- You do not expect another IPA for bugs you already saw on iPad

Then:

1. App Store Connect → TestFlight → the **same** internal group (or a second internal tester).
2. Add the relative’s **Apple ID** (the one on that iPhone). He does not need an Admin role.
3. He installs **TestFlight**, accepts the email / invite, installs this build. No USB, no UDID, no 7-day Personal Team app.
4. Tell him: do not update to a newer TestFlight build unless you ask — you want this exact `buildNumber`.

If you must rebuild after this, he will have to install again. That is why this step is last.

### iPhone-only checks (skip these on the iPad)

**Phone / audio session**

- [ ] Incoming **phone call** while streaming: pause, then auto-resume when the call ends ([manual-test-plan.md](./manual-test-plan.md) §3).
- [ ] FaceTime / voicemail overlay: pause / resume is sane; Now Playing does not stick in a dead buffer.

**Network**

- [ ] Stream on **cellular**.
- [ ] Wi‑Fi ↔ cellular while streaming: audio keeps going.
- [ ] Settings **Download on Wi-Fi only** default on: cellular download refused, points to Settings.
- [ ] Wi-Fi only **off**: warn before downloading on mobile data, then a cellular download completes.

**Headset / lock screen (real iPhone chrome)**

- [ ] Wired or Bluetooth headset: play/pause and the mapped skip or ±10 match **Lock screen and headset buttons**.
- [ ] iPhone Control Center and lock screen Now Playing: same mapping. When primary is ±10, numbered ±10 **and** next/prev stay on (headset/car next-prev still seek ±10).
- [ ] Compact Now Playing / mini player: nothing clipped under Dynamic Island / home indicator.

**Sanity (short)**

- [ ] Cold start, play one album, lock the phone, audio continues.
- [ ] Airplane + a downloaded album plays.

He does not need to re-run the whole iPad checklist. If something fails here that already passed on iPad, it is almost certainly phone-session / radio — fix, bump `buildNumber`, TestFlight **iPad first again**, then send him the new build.

---



## 11. Submit for App Review

TestFlight is not the store.

1. App Store Connect → the version → **Add Build** → the TestFlight build both devices ran.
2. Encryption / advertising / IDFA questions.
3. **Add for Review** → **Submit to App Review**.

First review is often 24–48 hours. Common iOS-only failures: broken Universal Links, background audio dying when locked, privacy text missing Sentry/Google, iPhone UI clipped, login implied with no demo account.

After **Approved**, release manually or automatically. That button is separate from TestFlight.

Later iOS JS: `OTA_CHANNEL=production OTA_PLATFORMS=ios npm run ota:publish`. Do not bump top-level `runtimeVersion` for iOS-only native; see [ota-updates.md](./ota-updates.md).

---



## Command cheat sheet

```bash
# Free: Simulator, or USB dev client on the plugged-in iPad
npm run ios

# Paid: store IPA on this Mac
unset APP_VARIANT
npm run build:ios:production

# Paid: upload that IPA
eas submit --platform ios --path ./build-ios.ipa --profile production
```

Android still has `build:android:preview` / `build:android:production`. iOS production is `build:ios:production` (`./build-ios.ipa`).