const { withAppDelegate } = require("expo/config-plugins");

const HELPER_NAME = "GAPExcludeRedownloadableFromICloudBackup";

const HELPER = `
// MMKV, downloaded audio, and OTA bundles are re-downloadable. Mark them
// excluded so iCloud/Finder restore does not bring back a skipped wizard
// (Android allowBackup is already false).
func ${HELPER_NAME}() {
  let fm = FileManager.default
  var urls: [URL] = []
  if let docs = fm.urls(for: .documentDirectory, in: .userDomainMask).first {
    urls.append(docs.appendingPathComponent("mmkv", isDirectory: true))
    urls.append(docs.appendingPathComponent("audio", isDirectory: true))
  }
  if let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
    urls.append(support.appendingPathComponent(".expo-internal", isDirectory: true))
  }
  for url in urls {
    try? fm.createDirectory(at: url, withIntermediateDirectories: true)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    var mutable = url
    try? mutable.setResourceValues(values)
  }
}
`;

const LAUNCH_RETURN =
  "return super.application(application, didFinishLaunchingWithOptions: launchOptions)";

/**
 * iOS has no allowBackup:false. Exclude re-downloadable dirs from device backup.
 */
function withIosExcludeFromBackup(config) {
  return withAppDelegate(config, (config) => {
    if (config.modResults.language !== "swift") {
      throw new Error(
        "with-ios-exclude-from-backup expects a Swift AppDelegate (Expo SDK 57)",
      );
    }
    let src = config.modResults.contents;
    if (src.includes(HELPER_NAME)) {
      return config;
    }
    if (!src.includes(LAUNCH_RETURN)) {
      throw new Error(
        "with-ios-exclude-from-backup: didFinishLaunching return not found; Expo AppDelegate template changed",
      );
    }
    src = src.replace(
      LAUNCH_RETURN,
      `${HELPER_NAME}()\n    ${LAUNCH_RETURN}`,
    );
    config.modResults.contents = `${src.trimEnd()}\n${HELPER}`;
    return config;
  });
}

module.exports = withIosExcludeFromBackup;
