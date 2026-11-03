import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Fast unit tests only. Bot-vs-bot strength runs: `npm run bench`.
    include: process.env.BENCH ? ['bench/**/*.test.ts'] : ['tests/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
