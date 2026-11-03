import { firebaseConfig } from '../runtimeConfig';
import type { AuthService } from './auth';
import type { Db } from './db';

export interface Backend {
  mode: 'firebase' | 'local';
  db: Db;
  auth: AuthService;
}

/**
 * Firebase web config: runtime /config.js (Docker env) first, then Vite
 * build-time env (.env.local). Not a secret. Null → local backend.
 */
export function firebaseConfigFromEnv() {
  return firebaseConfig();
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
