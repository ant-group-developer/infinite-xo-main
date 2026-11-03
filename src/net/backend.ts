import type { AuthService } from './auth';
import type { Db } from './db';

export interface Backend {
  mode: 'firebase' | 'local';
  db: Db;
  auth: AuthService;
}

/** Firebase web config from Vite env (`.env.local`, see .env.example). Not a secret. */
export function firebaseConfigFromEnv() {
  const e = import.meta.env;
  if (!e.VITE_FIREBASE_API_KEY || !e.VITE_FIREBASE_DATABASE_URL) return null;
  return {
    apiKey: e.VITE_FIREBASE_API_KEY as string,
    authDomain: e.VITE_FIREBASE_AUTH_DOMAIN as string,
    databaseURL: e.VITE_FIREBASE_DATABASE_URL as string,
    projectId: e.VITE_FIREBASE_PROJECT_ID as string,
    storageBucket: e.VITE_FIREBASE_STORAGE_BUCKET as string,
    messagingSenderId: e.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
    appId: e.VITE_FIREBASE_APP_ID as string,
    measurementId: e.VITE_FIREBASE_MEASUREMENT_ID as string | undefined,
  };
}

let backend: Promise<Backend> | null = null;

/**
 * Lazily loads the backend. Firebase SDK is only downloaded when the player
 * opens online mode, so the offline game stays small.
 * `?local=1` in the URL forces the local multi-tab backend.
 */
export function getBackend(): Promise<Backend> {
  if (backend) return backend;
  const cfg = firebaseConfigFromEnv();
  const forceLocal = typeof location !== 'undefined' && new URLSearchParams(location.search).has('local');
  backend = (async (): Promise<Backend> => {
    if (cfg && !forceLocal) {
      const [{ initializeApp }, { FirebaseDb }, { FirebaseAuthService }] = await Promise.all([
        import('firebase/app'),
        import('./firebase/firebaseDb'),
        import('./firebase/firebaseAuth'),
      ]);
      const app = initializeApp(cfg);
      return { mode: 'firebase', db: new FirebaseDb(app, cfg.databaseURL), auth: new FirebaseAuthService(app) };
    }
    const [{ LocalDb, SharedWorkerStore, MemoryStore }, { LocalAuth }] = await Promise.all([
      import('./local/localDb'),
      import('./auth'),
    ]);
    let store: import('./local/localDb').LocalStore;
    if (typeof SharedWorker !== 'undefined') {
      const sw = new SharedWorkerStore();
      await sw.ready;
      store = sw;
    } else {
      store = new MemoryStore(); // e.g. Android Chrome: single-tab only
    }
    const db = new LocalDb(store);
    // Closing the tab = disconnecting: run onDisconnect ops like the server would.
    window.addEventListener('pagehide', () => db.simulateDisconnect());
    return { mode: 'local', db, auth: new LocalAuth() };
  })();
  return backend;
}
