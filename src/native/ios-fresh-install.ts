import { Platform } from "react-native";

/**
 * iOS Keychain survives delete+reinstall; MMKV does not. Phase 6 JS is stubbed but
 * native Google/Firebase are linked, so wipe them when the sandbox looks first-run.
 */
export async function clearStaleIosAuth(): Promise<void> {
  if (Platform.OS !== "ios") {
    return;
  }
  try {
    const { GoogleSignin } = await import("@react-native-google-signin/google-signin");
    await GoogleSignin.signOut();
  } catch {
    // configure() is Phase 6; signOut throws if the SDK was never set up.
  }
  try {
    // RN Firebase v22+ is modular: there is no default export (namespaced `auth()`).
    const { getAuth } = await import("@react-native-firebase/auth");
    const auth = getAuth();
    if (auth.currentUser) {
      await auth.signOut();
    }
  } catch {
    // Native module missing (Expo Go) or no session.
  }
}
