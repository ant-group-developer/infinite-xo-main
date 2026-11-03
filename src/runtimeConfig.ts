/**
 * Runtime configuration.
 *
 * In Docker the container writes /config.js from environment variables at
 * start-up (see docker/40-app-config.sh), so one image works for every
 * environment. In `npm run dev` (or a plain static build) we fall back to
 * Vite's build-time `import.meta.env` (.env.local).
 *
 * Keys use the same names in both places: VITE_FIREBASE_API_KEY, …
 */
type Raw = Record<string, string | undefined>;

declare global {
  interface Window {
    __APP_CONFIG__?: Raw;
  }
}

function raw(): Raw {
  const fromRuntime = (typeof window !== 'undefined' && window.__APP_CONFIG__) || {};
  const fromBuild = (import.meta.env ?? {}) as Raw;
  const out: Raw = {};
  for (const [k, v] of Object.entries(fromBuild)) if (typeof v === 'string' && v) out[k] = v;
  for (const [k, v] of Object.entries(fromRuntime)) if (typeof v === 'string' && v) out[k] = v; // runtime wins
  return out;
}

export function config(key: string): string | undefined {
  return raw()[key];
}

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  measurementId?: string;
}

/** Firebase web config, or null when not configured (→ local backend). Not secret. */
export function firebaseConfig(): FirebaseWebConfig | null {
  const c = raw();
  if (!c.VITE_FIREBASE_API_KEY || !c.VITE_FIREBASE_DATABASE_URL) return null;
  return {
    apiKey: c.VITE_FIREBASE_API_KEY,
    authDomain: c.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    databaseURL: c.VITE_FIREBASE_DATABASE_URL,
    projectId: c.VITE_FIREBASE_PROJECT_ID ?? '',
    storageBucket: c.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: c.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: c.VITE_FIREBASE_APP_ID,
    measurementId: c.VITE_FIREBASE_MEASUREMENT_ID,
  };
}

/** Online features can be switched off per deployment (VITE_ONLINE_ENABLED=false). */
export const onlineEnabled = () => (config('VITE_ONLINE_ENABLED') ?? 'true').toLowerCase() !== 'false';

/** Optional public URL used in invite links (e.g. the page that embeds the game). */
export const publicUrl = () => config('VITE_PUBLIC_URL');

/** Running inside an <iframe>? */
export const isEmbedded = () => {
  try {
    return window.self !== window.top;
  } catch {
    return true; // cross-origin parent
  }
};
