const appUrl = import.meta.env.VITE_REPEATER_NATION_APP_URL || "https://repeaternation.com";

export const config = {
  appUrl,
  base44AppId: import.meta.env.VITE_BASE44_APP_ID || "6a6d787f8e808727b935dd09",
  base44AppBaseUrl: import.meta.env.VITE_BASE44_APP_BASE_URL || appUrl,
  livekitUrl: import.meta.env.VITE_LIVEKIT_URL || "wss://voice.repeaternation.com",
  dispatchRoles: (import.meta.env.VITE_DISPATCH_ROLES || "admin,super_admin,moderator").split(",").map((r) => r.trim().toLowerCase()).filter(Boolean),
};
