import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs: the build works under any sub-path (e.g. /games/xo/) and inside iframes.
  base: './',
  optimizeDeps: {
    // Firebase is imported lazily (dynamic import) when the player opens Online.
    // Pre-bundle all of its entry points together at startup; otherwise the dev
    // server optimises them in separate passes and firebase/database cannot see
    // the firebase/app instance ("Service database is not available").
    include: ['firebase/app', 'firebase/auth', 'firebase/database', 'firebase/analytics'],
  },
});
