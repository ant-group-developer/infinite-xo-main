import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // PORT from .env / .env.local also drives `npm run dev` and `npm run preview`.
  const env = loadEnv(mode, process.cwd(), '');
  const port = Number(env.PORT) || undefined;

  return {
    // Relative asset URLs: the build works under any sub-path (e.g. /games/xo/) and inside iframes.
    base: './',
    server: { port },
    preview: { port },
    optimizeDeps: {
      // Firebase is imported lazily (dynamic import) when the player opens Online.
      // Pre-bundle all of its entry points together at startup; otherwise the dev
      // server optimises them in separate passes and firebase/database cannot see
      // the firebase/app instance ("Service database is not available").
      include: ['firebase/app', 'firebase/auth', 'firebase/database', 'firebase/analytics'],
    },
  };
});
