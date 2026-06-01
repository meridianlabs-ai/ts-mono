// Kept dependency-free: it is imported by the theme bootstrap entry that is
// esbuild-bundled into a tiny inline <script>, so it must not drag in React or
// the zustand store.
export const SETTINGS_STORAGE_KEY = "inspect-scout-user-settings";
