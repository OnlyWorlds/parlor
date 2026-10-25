/// <reference types="vitest" />
import { defineConfig } from 'vite';

// No proxy and no key: each person talks to OnlyWorlds on their own credential
// (the parlor design sheet §4). A dev run against staging adds ?api=<base>.
export default defineConfig({
  base: './',
  server: {
    port: 30335,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
