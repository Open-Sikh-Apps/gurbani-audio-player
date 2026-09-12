import { createHash, randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFingerprintAsync,
  diffFingerprints,
  type Fingerprint,
  type FingerprintDiffItem,
  type FingerprintSource,
} from "expo/fingerprint";

import { otaCreatedAt, uuidFromSha256Hex } from "../src/updates/launch-hash";

type PlatformMeta = {
  bundle: string;
  assets: { path: string; ext: string }[];
};

type ExportMetadata = {
  fileMetadata: {
    android?: PlatformMeta;
    ios?: PlatformMeta;
  };
};

const ROOT = join(__dirname, "..");
const DIST = join(ROOT, "dist-update");
const CHANNEL = process.env.OTA_CHANNEL ?? "preview";
const APP_JSON = readAppJsonExpo();
// R2 prefix must match the runtimeVersion baked into the binary (`app.json`).
const RUNTIME = process.env.OTA_RUNTIME_VERSION ?? APP_JSON.runtimeVersion;
const PUBLIC_URL = (
  process.env.OTA_PUBLIC_URL ?? "https://updatesgurbaniaudioplayer.opensikhapps.com"
).replace(/\/$/, "");
// Orange-cloud R2 host — apply downloads skip the Worker. Check still uses PUBLIC_URL.
const FILES_URL = (
  process.env.OTA_FILES_URL ?? "https://gurbaniaudioplayer-updates.opensikhapps.com"
).replace(/\/$/, "");
const BUCKET = process.env.OTA_R2_BUCKET ?? "gurbaniaudioplayer-updates";
const PLATFORMS = parsePlatforms();
const CHECK_ONLY = process.argv.includes("--fingerprint-check");
const ALLOW_NATIVE_CHANGE = process.env.OTA_ALLOW_NATIVE_CHANGE === "1";
const ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
const MANIFEST_CACHE_CONTROL = "private, max-age=0";
const FINGERPRINT_OBJECT = "fingerprint.json";

function parsePlatforms(): ("android" | "ios")[] {
  const raw = (process.env.OTA_PLATFORMS ?? "android")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const platforms: ("android" | "ios")[] = [];
  for (const part of raw) {
    if (part !== "android" && part !== "ios") {
      throw new Error(`OTA_PLATFORMS has unsupported platform ${part}`);
    }
    platforms.push(part);
  }
  if (platforms.length === 0) {
    throw new Error("OTA_PLATFORMS is empty");
  }
  return platforms;
}

function readAppJsonExpo(): {
  runtimeVersion: string;
  version: string;
  expoClient: Record<string, unknown>;
} {
  const appJson = JSON.parse(readFileSync(join(ROOT, "app.json"), "utf8")) as {
    expo?: {
      runtimeVersion?: unknown;
      version?: unknown;
      name?: unknown;
      slug?: unknown;
      scheme?: unknown;
      extra?: unknown;
      ios?: { bundleIdentifier?: unknown };
      android?: { package?: unknown };
    };
  };
  const expo = appJson.expo;
  const runtimeVersion = expo?.runtimeVersion;
  const version = expo?.version;
  const scheme = expo?.scheme;
  if (typeof runtimeVersion !== "string" || runtimeVersion.length === 0) {
    throw new Error("app.json is missing a string expo.runtimeVersion");
  }
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("app.json is missing a string expo.version");
  }
  if (typeof scheme !== "string" || scheme.length === 0) {
    throw new Error("app.json is missing a string expo.scheme");
  }
  // After apply, Constants.expoConfig is this object. scheme is required or
  // expo-router Linking.createURL('/') throws on the preview APK.
  return {
    runtimeVersion,
    version,
    expoClient: {
      name: expo?.name,
      slug: expo?.slug,
      scheme,
      version,
      ios: { bundleIdentifier: expo?.ios?.bundleIdentifier },
      android: { package: expo?.android?.package },
      extra: expo?.extra,
      // JS reads channel from expoConfig after apply; native still sends the binary header.
      updates: {
        requestHeaders: {
          "expo-channel-name": CHANNEL,
        },
      },
    },
  };
}

function sha256Base64Url(buf: Buffer): string {
  // Expo Updates protocol hash (base64url), not hex.
  return createHash("sha256").update(buf).digest("base64url");
}

function uuidFromLaunchHash(hash: string): string {
  const hex = createHash("sha256").update(`ota-launch:${hash}`).digest("hex");
  return uuidFromSha256Hex(hex);
}

function publishCreatedAt(): string {
  let dirty = true;
  let gitCommitIso: string | null = null;
  try {
    dirty =
      execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" }).trim()
        .length > 0;
    gitCommitIso = execSync("git log -1 --format=%cI", {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    // No git — fall through to wall clock.
  }
  return otaCreatedAt({ workingTreeDirty: dirty, gitCommitIso, nowMs: Date.now() });
}

function md5Hex(buf: Buffer): string {
  return createHash("md5").update(buf).digest("hex");
}

function mimeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  // Hermes bytecode is not JS. application/javascript lets Cloudflare minify it
  // and expo-updates then rejects the SHA-256 (Failed to download new update).
  if (ext === "hbc" || ext === "bin") return "application/octet-stream";
  if (ext === "js") return "application/javascript";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "ttf" || ext === "otf") return "font/ttf";
  return "application/octet-stream";
}

function cacheControlFor(r2Key: string): string {
  if (r2Key.endsWith("manifest.json") || r2Key.endsWith(FINGERPRINT_OBJECT)) {
    return MANIFEST_CACHE_CONTROL;
  }
  return ASSET_CACHE_CONTROL;
}

function downloadPublicHash(url: string): string {
  const tmp = join(DIST, `.cdn-verify-${randomUUID()}`);
  // identity so we hash the object bytes, not a gzip wrapper Cloudflare might add.
  execSync(
    `curl -fsS -D /dev/stderr -o ${JSON.stringify(tmp)} -H "Accept-Encoding: identity" ${JSON.stringify(url)}`,
    { cwd: ROOT, stdio: "inherit" },
  );
  const actual = sha256Base64Url(readFileSync(tmp));
  try {
    execSync(`rm -f ${JSON.stringify(tmp)}`);
  } catch {
    // temp file is under dist-update; next export --output-dir replaces the folder.
  }
  return actual;
}

function verifyPublicHash(url: string, expected: string): void {
  const first = downloadPublicHash(url);
  if (first !== expected) {
    throw new Error(`Downloaded hash ${first} != ${expected} for ${url} (first GET).`);
  }
  // Second GET is the one that becomes HIT. A truncated first fill would pass a MISS
  // and then poison every phone — catch that here before swapping manifest.json.
  const second = downloadPublicHash(url);
  if (second !== expected) {
    throw new Error(
      `Downloaded hash ${second} != ${expected} for ${url} (second GET / likely CDN HIT). Purge that URL and republish.`,
    );
  }
}

function execErrorText(err: unknown): string {
  if (err && typeof err === "object" && "stderr" in err) {
    const stderr = (err as { stderr?: Buffer | string }).stderr;
    if (stderr) {
      return Buffer.isBuffer(stderr) ? stderr.toString("utf8") : stderr;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

function isR2NotFound(err: unknown): boolean {
  const text = execErrorText(err).toLowerCase();
  return (
    text.includes("not found") ||
    text.includes("does not exist") ||
    text.includes("no such object") ||
    text.includes("404")
  );
}

function isFingerprint(value: unknown): value is Fingerprint {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Fingerprint).hash === "string" &&
    Array.isArray((value as Fingerprint).sources)
  );
}

function sourceLabel(source: FingerprintSource): string {
  return source.type === "contents" ? source.id : source.filePath;
}

function formatFingerprintDiff(diff: FingerprintDiffItem[]): string {
  return diff
    .map((item) => {
      if (item.op === "added") return `  added    ${sourceLabel(item.addedSource)}`;
      if (item.op === "removed") return `  removed  ${sourceLabel(item.removedSource)}`;
      return `  changed  ${sourceLabel(item.afterSource)}`;
    })
    .join("\n");
}

function r2GetFingerprint(key: string): { kind: "missing" } | { kind: "ok"; fingerprint: Fingerprint } {
  const dest = join(tmpdir(), `ota-fp-${randomUUID()}.json`);
  try {
    // wrangler --remote, not the orange-cloud URL — a cached HIT would hide a native change.
    execSync(
      `npx wrangler r2 object get ${JSON.stringify(`${BUCKET}/${key}`)} --file ${JSON.stringify(dest)} --remote --config ota/wrangler.toml`,
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    if (isR2NotFound(err)) {
      return { kind: "missing" };
    }
    throw new Error(`Failed to read r2://${BUCKET}/${key}: ${execErrorText(err).trim()}`);
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(dest, "utf8"));
    if (!isFingerprint(parsed)) {
      throw new Error(`r2://${BUCKET}/${key} is not an Expo fingerprint JSON`);
    }
    return { kind: "ok", fingerprint: parsed };
  } finally {
    try {
      unlinkSync(dest);
    } catch {
      // tmp file; next run uses a new UUID.
    }
  }
}

function r2Put(key: string, filePath: string, contentType: string, cacheControl: string): void {
  // Default wrangler R2 put is local Miniflare; the Worker on the custom domain reads remote R2.
  execSync(
    `npx wrangler r2 object put ${JSON.stringify(`${BUCKET}/${key}`)} --file ${JSON.stringify(filePath)} --content-type ${JSON.stringify(contentType)} --cache-control ${JSON.stringify(cacheControl)} --remote --config ota/wrangler.toml`,
    { cwd: ROOT, stdio: "inherit" },
  );
}

function nativeChangeMessage(platform: string, diff: FingerprintDiffItem[]): string {
  return (
    `native fingerprint changed for ${platform} since last ota:publish.\n` +
    `${formatFingerprintDiff(diff)}\n` +
    `Rebuild the APK/AAB and bump runtimeVersion before publishing JS, or set OTA_ALLOW_NATIVE_CHANGE=1 if that binary is already out.`
  );
}

// Null means hashing failed; publish still proceeds so a fingerprint bug cannot block JS-only OTA.
async function assertNativeMatchesLastPublish(
  platform: "android" | "ios",
): Promise<Fingerprint | null> {
  let current: Fingerprint;
  try {
    current = await createFingerprintAsync(ROOT, { platforms: [platform], silent: true });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (CHECK_ONLY) {
      throw new Error(`native fingerprint failed for ${platform}: ${detail}`);
    }
    // Hashing is advisory. A throw here must not skip a JS-only publish.
    console.warn(`native fingerprint skipped for ${platform}: ${detail}`);
    return null;
  }
  const previous = r2GetFingerprint(`${CHANNEL}/${platform}/${RUNTIME}/${FINGERPRINT_OBJECT}`);
  if (previous.kind === "missing") {
    console.log(`no native fingerprint baseline for ${platform} yet (first publish after this gate)`);
    return current;
  }
  const diff = diffFingerprints(previous.fingerprint, current);
  if (diff.length === 0) {
    console.log(`native fingerprint matches last ota:publish (${platform} ${current.hash})`);
    return current;
  }
  const message = nativeChangeMessage(platform, diff);
  if (!CHECK_ONLY && ALLOW_NATIVE_CHANGE) {
    console.warn(message);
    return current;
  }
  throw new Error(message);
}

function putNativeFingerprint(platform: string, fingerprint: Fingerprint): void {
  const prefix = `${CHANNEL}/${platform}/${RUNTIME}`;
  const abs = join(DIST, `fingerprint-${platform}.json`);
  writeFileSync(abs, `${JSON.stringify(fingerprint)}\n`);
  r2Put(`${prefix}/${FINGERPRINT_OBJECT}`, abs, "application/json", MANIFEST_CACHE_CONTROL);
}

function publicFileUrl(platform: string, r2Key: string): string {
  return `${FILES_URL}/${CHANNEL}/${platform}/${RUNTIME}/${r2Key}`;
}

function buildManifest(
  platform: string,
  meta: PlatformMeta,
): { manifest: Record<string, unknown>; files: { r2Key: string; abs: string }[] } {
  const files: { r2Key: string; abs: string }[] = [];
  const bundleAbs = join(DIST, meta.bundle);
  const bundleBuf = readFileSync(bundleAbs);
  const bundleHash = sha256Base64Url(bundleBuf);
  // Content-hashed .bin, not `_expo/static/js/.../index.hbc`. Cloudflare's JS
  // minify path truncated that URL on cache HIT (SHA-256 fail). `.bin` is on
  // the default cacheable list and a new hash is a new cache key every publish.
  const launchR2Key = `launch/${bundleHash}.bin`;
  files.push({ r2Key: launchR2Key, abs: bundleAbs });
  const launchAsset = {
    hash: bundleHash,
    key: md5Hex(bundleBuf),
    contentType: "application/octet-stream",
    fileExtension: ".hbc",
    url: publicFileUrl(platform, launchR2Key),
  };
  const assets = meta.assets.map((asset) => {
    const abs = join(DIST, asset.path);
    const buf = readFileSync(abs);
    files.push({ r2Key: asset.path, abs });
    const ext = asset.ext.startsWith(".") ? asset.ext : `.${asset.ext}`;
    return {
      hash: sha256Base64Url(buf),
      key: md5Hex(buf),
      contentType: mimeFor(asset.path),
      fileExtension: ext,
      url: publicFileUrl(platform, asset.path),
    };
  });
  return {
    manifest: {
      // Same Hermes bytes → same id so the Worker can skip without a launch-hash extra param.
      id: uuidFromLaunchHash(bundleHash),
      createdAt: publishCreatedAt(),
      runtimeVersion: RUNTIME,
      launchAsset,
      assets,
      metadata: { channel: CHANNEL, launchHash: bundleHash },
      // After a downloaded update, Constants.expoConfig is extra.expoClient — not the embedded app.json.
      extra: { expoClient: APP_JSON.expoClient },
    },
    files,
  };
}

async function main(): Promise<void> {
  const fingerprints = new Map<string, Fingerprint>();
  // Gate before `expo export` so a native mismatch does not wait on a bundle that will not ship.
  for (const platform of PLATFORMS) {
    const fingerprint = await assertNativeMatchesLastPublish(platform);
    if (fingerprint) {
      fingerprints.set(platform, fingerprint);
    }
  }
  if (CHECK_ONLY) {
    return;
  }

  const expoPlatforms = PLATFORMS.map((p) => `--platform ${p}`).join(" ");
  execSync(`npx expo export ${expoPlatforms} --output-dir dist-update`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  const metadataPath = join(DIST, "metadata.json");
  if (!existsSync(metadataPath)) {
    throw new Error("expo export did not write dist-update/metadata.json");
  }
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as ExportMetadata;
  for (const platform of PLATFORMS) {
    const meta = metadata.fileMetadata[platform];
    if (!meta) {
      throw new Error(`metadata.json has no ${platform} bundle`);
    }
    const { manifest, files } = buildManifest(platform, meta);
    const prefix = `${CHANNEL}/${platform}/${RUNTIME}`;
    for (const file of files) {
      r2Put(
        `${prefix}/${file.r2Key}`,
        file.abs,
        mimeFor(file.r2Key),
        cacheControlFor(file.r2Key),
      );
    }
    const launch = manifest.launchAsset as { url: string; hash: string };
    // Hash the CDN URL before swapping manifest.json so a bad HIT cannot go live.
    verifyPublicHash(launch.url, launch.hash);
    const manifestPath = join(DIST, `manifest-${platform}.json`);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    r2Put(`${prefix}/manifest.json`, manifestPath, "application/json", MANIFEST_CACHE_CONTROL);
    const fingerprint = fingerprints.get(platform);
    if (fingerprint) {
      // Sidecar only — phones never fetch this; the protocol manifest is unchanged.
      putNativeFingerprint(platform, fingerprint);
    }
    console.log(`published ${platform} runtime ${RUNTIME} ${manifest.id as string}`);
    console.log(`  createdAt ${manifest.createdAt as string}`);
    console.log(`  check ${PUBLIC_URL}  files ${FILES_URL}/${prefix}/`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
