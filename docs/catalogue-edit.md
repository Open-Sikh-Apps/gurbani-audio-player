# Edit the catalogue (day to day)

The app reads **Cloudflare Pages** JSON (`catalogue.version.json` then `catalogue.json?v=`). It never calls Sanity. Day-to-day edits are a **JSON edit + optional R2 put**, not a Khajana script rebuild.

Repo: `Open-Sikh-Apps/gurbani-paath-player-catalogue`. CI checkouts this app, fills missing `byteSize`, Valibot-validates, Direct-Uploads to Pages.

Keep [`docs/khajana-publish.md`](khajana-publish.md) for a **bulk first import** of a reciter folder of filenames. Do not run `khajana:build-catalogue` to add one audiobook, one radio, or a title tweak — it rewrites titles from filenames.

---

## Add or update a collection

### 1. Audio / art on R2 (if the file is new)

Bucket `gurbaniaudioplayerfiles`, public host `https://gurbaniaudioplayerfiles.opensikhapps.com`.

Keys are **immutable**:

- `/audio/{collectionId}/{trackId}.mp3`
- `/images/{name}.jpg` (or similar)

New file or changed audio → **new `trackId`** (and a new object). Same `trackId` with different bytes will poison the CDN cache.

```bash
npx wrangler r2 object put gurbaniaudioplayerfiles/audio/{collectionId}/{trackId}.mp3 \
  --file ./local.mp3 \
  --content-type audio/mpeg \
  --cache-control "public, max-age=31536000, immutable" \
  --remote
```

Radio streams can be an `https://` URL in the catalogue instead of an R2 path.

### 2. Edit `catalogue.json`

Copy an existing collection of the right `kind` (keep `languages` and `downloadable`):

| `kind` | Required extras |
|---|---|
| `sehaj_paath` | `reciterId`, `scriptureId`, tracks with `durationSec` + `byteSize`, optional `startAng` |
| `audiobook` | tracks with `durationSec` + `byteSize`, optional `readAlongUrl` |
| `radio` | tracks (no `durationSec` / `byteSize`; live streams) |

Every `id` (author, reciter, scripture, collection, track, resource) must be unique across the whole file. New ids: `uuidgen`. `en` is required on every `L10nText`; add `pa` when you have it. No photos of Gursikhs.

If you add a reciter or scripture, add those objects too. Home V1 only lists `sehaj_paath` grouped by scripture. Resources go in `resourceSections` + `resources` (`sectionId`).

### 3. Bump version

Bump **both** `catalogue.json` `version` and `catalogue.version.json` to the same integer.

### 4. Push the catalogue repo

CI fills `byteSize` when missing (`scripts/fill-catalogue-bytesize.ts` HEADs the media URL) and Valibot-rejects invalid JSON. Cold start or Home pull-to-refresh picks it up.

App `.env`: `EXPO_PUBLIC_CATALOGUE_BASE_URL` (Pages origin, no trailing slash) and `EXPO_PUBLIC_MEDIA_BASE_URL`. Metro only. `eas build --local` uses `eas.json` `build.*.env`. `EXPO_PUBLIC_USE_MOCK_CATALOGUE=1` stays on bundled `mock-catalogue.json` (no Pages). Restart Metro after changing.

---

## Custom domain for catalogue JSON

The app only needs an HTTPS origin that serves `catalogue.version.json` and `catalogue.json`. Media stays on `gurbaniaudioplayerfiles.opensikhapps.com`. CI Direct-Uploads to the same Pages project; a custom hostname is an alias, not a new deploy.

Pick a **subdomain** (apex `opensikhapps.com` needs Cloudflare nameservers). Match existing hosts, e.g. `cataloguegurbaniaudioplayer.opensikhapps.com` (same style as `updatesgurbaniaudioplayer` and `gurbaniaudioplayerfiles`).

1. **Pages first, then DNS.** Cloudflare dashboard → Workers & Pages → `gurbani-paath-player-catalogue` → **Custom domains** → **Set up a domain** → enter the hostname → Continue. Do not create the CNAME by hand first; that yields a **522**.
2. If `opensikhapps.com` is already a zone on the **same** Cloudflare account, Pages adds the CNAME. Otherwise add at the DNS host: `CNAME` → hostname → `gurbani-paath-player-catalogue.pages.dev`. Wait until the custom domain shows **Active** (SSL is automatic).
3. Confirm both URLs return the same JSON (no trailing slash on the origin):

   ```bash
   curl -sI "https://YOUR-HOST/catalogue.version.json"
   curl -sI "https://gurbani-paath-player-catalogue.pages.dev/catalogue.version.json"
   ```

   Native axios does not use browser CORS. Keep `pages.dev` as a fallback; CI does not need to change.
4. Point the **app** at the new origin (no trailing slash) in **both**:
   - `.env` — Metro / `npx expo start`
   - `eas.json` → `build.preview.env.EXPO_PUBLIC_CATALOGUE_BASE_URL` (production extends preview)
5. **Ship the URL.** `EXPO_PUBLIC_*` is inlined at `expo export`. Store users already on an AAB keep `pages.dev` until the next OTA (or a new binary). After the `eas.json` env edit, `ota:fingerprint-check` may fail because `eas.json` is in the native fingerprint — publish with `OTA_ALLOW_NATIVE_CHANGE=1`. Metro `.env` never reaches `eas build --local`.
6. Restart Metro; on a device, cold start or Home pull-to-refresh. Optional: keep `pages.dev` forever so old JS still works.

---

## Title-only (no new audio)

Edit `catalogue.json`, bump version, push. Do **not** run `khajana:build-catalogue`. Re-tag / re-put R2 objects only if you need new ID3 on the files.

---

## Do not

- Change a published `trackId` / `collectionId` without a new R2 object and a new catalogue row.
- Guess `byteSize` from bitrate; omit it and let CI HEAD, or copy Content-Length from the put.
- Put Worker `X-App-Origin` on these public media URLs.
