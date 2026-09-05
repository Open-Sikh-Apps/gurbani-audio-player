Historical notes (Gemini). The running pipeline is [ota-updates.md](./ota-updates.md) (self-hosted Worker + R2, local EAS AAB, `runtimeVersion` `1.0.3`).

https://share.gemini.google/KnN5wpM4ecss

Here is a brief summary of the completely free, self-hosted CI/CD and OTA update pipeline for your React Native app.

### 1. Automated Native Builds via GitHub Actions

Instead of using paid cloud services, you can compile your native app binaries directly on GitHub Actions. Android builds (`.aab`/`.apk`) run on free Linux runners, and iOS builds (`.ipa`) run on macOS runners. From there, you can automate direct uploads to the Google Play Store and Apple App Store Connect using standard deployment tools, ensuring your core native app updates (like adding new native libraries) are handled completely hands-off.

### 2. Self-Hosted OTA Updates Workflow

For JavaScript and asset updates that don't require app store approval, you can bypass third-party paid limits by building a self-hosted pipeline:

* **GitHub Actions:** Compiles your static JS bundle and syncs it to a Cloudflare R2 storage bucket.
* **Cloudflare Worker:** Acts as the "brains" of the operation. It intercepts update requests from the app, reads the static manifest file from your R2 bucket, and returns it to the device with the strict protocol headers required by Expo.

### 3. App-Side Logic & Analytics

Inside the app, you configure `app.json` to point to your Cloudflare Worker URL. You can choose to have the app pull these updates silently in the background on cold boot, or disable automatic checks to manually trigger a consent modal showing release notes. For analytics, you rely on Cloudflare's free built-in metric tracking for network requests and bandwidth, combined with standard in-app logging triggers when a device successfully fetches and applies the new bundle.

### 4. Caching with a CDN (Your Question)

**Yes, you can absolutely put the JS bundles and assets on R2 behind a CDN.**

In fact, it is highly recommended. Because R2 is built by Cloudflare, you can route a custom domain through Cloudflare's standard CDN proxy (the "orange cloud").

By setting proper cache-control headers on your static assets, Cloudflare’s global edge network will cache the heavy `.bundle` files and images. When a user's device requests the update, the CDN serves it locally from their nearest geographic node. This dramatically speeds up the OTA download for the user and prevents those requests from ever hitting your R2 bucket, saving you a massive amount of Class B read operations. Only the dynamic worker request for the manifest needs to execute every time.