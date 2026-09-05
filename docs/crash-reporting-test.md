# Crash reporting — manual test (§7)

How to run [manual-test-plan.md](./manual-test-plan.md) §7 on the Play-bound **preview APK**.

Use that installed APK, not Metro. Sentry is off in `__DEV__` (`enabled: Boolean(dsn) && !__DEV__` in `src/crash/init.ts`), so `expo start` will never show a real report.

There is no in-app “crash me” button. Add a **temporary** throw, get that JS onto the device, test, then remove it. Do not leave these snippets in a bundle testers keep.

---

## Before you start

1. Confirm you are on the **preview APK** (not Expo Go / Metro).
2. Note the APK’s `runtimeVersion` (`app.json` is `1.0.3` today). OTA only applies if the publish folder matches **that** binary. See [ota-updates.md](./ota-updates.md).
3. Open Sentry → org **jasdeep-singh-malhotra** → project **gurbaniaudioplayer** → **Issues**. Keep that tab open so you can match timestamps.

Do the **Don’t send** pass first, then **Send**, so you can tell the two runs apart.

---

## A. JS `ErrorBoundary` (required)

### 1. Add a one-shot throw

The flag must live **outside** `HomeScreen`. `useState` / `useRef` / a `let` inside the component all reset when **OK** remounts Home, so the throw would fire again and Home would never stay up.

In `src/screens/home.tsx`:

```tsx
let didThrowForTest = false;

export function HomeScreen() {
  // …existing hooks…

  useEffect(() => {
    if (didThrowForTest) {
      return;
    }
    didThrowForTest = true;
    throw new Error("manual-test-plan §7 JS ErrorBoundary");
  }, []);
```

That screen sits inside `CrashErrorBoundary` in root layout, so this is the right kind of crash (a React render/effect error, not a native SIGSEGV).

### 2. Get that JS onto the APK

**OTA** (if this device already has the matching `runtimeVersion`):

```bash
npm run ota:publish
```

Then on the device: force-quit → cold start (idle) and apply **Update ready**, or **Settings → Check for update**.

**Otherwise** rebuild and reinstall the preview APK. Do not use Metro.

### 3. Trigger it

Open the app and land on **Home**. You should get a system alert:

- Title: **Something went wrong**
- Body: **Send a report to the developer so this can be fixed.**
- Buttons: **Don't send** and **Send report**

Behind the alert, the fallback screen is the same title plus **OK** (that remounts the tree without killing the process).

### 4. Pass 1 — Don’t send

1. Tap **Don't send**.
2. Tap **OK** on the fallback screen.
3. Home (and playback, if it was running) should come back. No native restart.
4. In Sentry, that timestamp should **not** have a new issue for `manual-test-plan §7 JS ErrorBoundary`.

### 5. Pass 2 — Send

Force-quit and reopen. A process death resets the module `let`, so Home throws once more.

1. Tap **Send report**.
2. Tap **OK**.
3. App recovers the same way.
4. Within a minute, Sentry should show an event with that error message. Open it and confirm it is a JS exception (not a native crash).

You should **not** see the next-launch alert (“Crash report sent”) after a JS error. That alert is only for a **native** crash that killed the process.

Remove this throw (and publish) before starting part B.

---

## B. Native crash (optional)

This path must **not** show Send / Don’t send. The native SDK sends on its own; the UI (`CrashLastRunNotice` → `Alert.alert`) only runs on the **next successful launch**, and only if Sentry saw a **process-killing** native crash (`Sentry.crashedLastRun() === true`) on the **same** OTA/binary as last time. A first launch of a new update (or Play Store APK) suppresses the alert even if Sentry still reports `true`. In-app Simple mode does not enlarge this alert (same as OTA / JS ErrorBoundary); system accessibility text size does.

### Do not use `Sentry.nativeCrash()` on this APK

`Sentry.nativeCrash()` throws a Java `RuntimeException` from a void TurboModule. Expo Updates’ error-recovery handler catches that, tears down the React host, and **leaves the Activity up** (blank screen). The process does not die, so:

- Sentry does **not** write a last-run crash marker
- the next open is a normal launch (no **Crash report sent** alert)
- nothing useful shows in Sentry

A persisted MMKV one-shot around that call only prevents a second blank screen. It cannot create the alert.

If that snippet is still in the running bundle, delete it from `src/screens/home.tsx` and `npm run ota:publish` so Home stays up.

### 1. Crash the process from adb (Home already showing)

USB debugging, app idle on Home, **no** JS throw in the bundle:

```bash
adb shell am crash com.opensikhapps.gurbaniaudioplayer
```

The app should leave Recents / “keeps stopping”, not sit on a blank Activity.

If that also blanks without dying, send SIGSEGV so the NDK handler runs (this is the crash type Sentry native is built for):

```bash
adb shell pidof com.opensikhapps.gurbaniaudioplayer
adb shell kill -s SIGSEGV "$(adb shell pidof com.opensikhapps.gurbaniaudioplayer)"
```

Wait a few seconds.

### 2. Relaunch and check the alert

1. Open the app from the launcher (new process).
2. After splash / “Loading…”, you should get a **system** `Alert.alert` (not a custom Modal):
   - Title: **Crash report sent**
   - Body: **A crash report was sent automatically. You can email the sevaadars regarding any problems or suggestions.**
   - **OK** and **Email** (opens the feedback mail composer)
3. There is **no** Send report / Don't send pair.
4. **OK** dismisses it; **Email** dismisses and opens mail.
5. Sentry should show a **native** crash (not the JS `Error` from part A). Force-quit / Recents swipe is **not** this test.

Uninstalling the app wipes Sentry’s last-run marker. Do not uninstall between the crash and this launch.

---

## C. Catalogue refresh (same §7, not a crash)

Do this on a **build without the throw**, or after Home is staying up.

1. On Home, **scroll down** so you can see whether the list jumps.
2. Header overflow (⋮) → **Refresh catalogue**.
   - List position stays put (no jump to the top).
   - Toast **Updating…** (not inline text on the page).
   - If the version is unchanged, that toast still appears briefly, then clears.
3. Pull-to-refresh: the **RefreshControl** spinner runs; you should **not** get the **Updating…** toast (pull already has its own spinner).
4. Refresh **error** (optional): stay “online” in NetInfo but make `https://cataloguegurbaniaudioplayer.opensikhapps.com` fail (Wi‑Fi with no internet often works). You want the toast **Could not refresh the catalogue. Showing the last saved copy.** Home must keep the last catalogue — it must not blank. Airplane mode is **not** this case: the store treats offline as idle, so there is no error toast.

---

## D. Tear out the throw

Before anyone else keeps this APK/OTA:

1. Delete the JS `let` / `useEffect` throw from Home if it is still there. Do not leave `Sentry.nativeCrash()` in the tree.
2. Publish again (`npm run ota:publish`) or reinstall a clean APK.
3. Cold start Home once and confirm it does **not** crash.

---

**Pass §7 when:** Don’t send sends nothing; Send shows a JS event; optional native crash auto-sends and the next launch is the Email/OK alert only; Home refresh uses toasts and does not jump; the debug throw is gone.
