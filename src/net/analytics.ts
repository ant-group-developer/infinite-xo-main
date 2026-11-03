import { firebaseConfigFromEnv } from './backend';

/**
 * Tiny analytics wrapper. With a Firebase config that has a measurementId it
 * lazily loads Firebase Analytics (retention D1/D7, funnels); otherwise it is a
 * no-op so the offline game never downloads the SDK.
 */
type LogFn = (name: string, params?: Record<string, unknown>) => void;
let logger: Promise<LogFn | null> | null = null;

function load(): Promise<LogFn | null> {
  if (logger) return logger;
  const cfg = firebaseConfigFromEnv();
  if (!cfg?.measurementId || typeof window === 'undefined') return (logger = Promise.resolve(null));
  logger = (async () => {
    try {
      const [{ getApps, initializeApp }, an] = await Promise.all([import('firebase/app'), import('firebase/analytics')]);
      if (!(await an.isSupported())) return null;
      const app = getApps()[0] ?? initializeApp(cfg);
      const a = an.getAnalytics(app);
      return (name: string, params?: Record<string, unknown>) => an.logEvent(a, name, params);
    } catch {
      return null;
    }
  })();
  return logger;
}

export function track(name: string, params?: Record<string, unknown>) {
  void load().then((log) => log?.(name, params));
}
