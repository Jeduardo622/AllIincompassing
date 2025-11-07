process.env.NODE_ENV = 'development';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/vitest.polyfills.ts', './src/test/setup.ts'],
    include: [
      'src/**/*.{test,spec}.{js,jsx,ts,tsx}',
      'src/**/*Integration*.test.{js,jsx,ts,tsx}',
      'tests/**/*.{test,spec}.{js,jsx,ts,tsx}',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.{js,ts}',
        '**/index.{js,ts}',
      ],
    },
    server: {
      deps: {
        inline: ['@supabase/supabase-js'],
      },
    },
    env: {
      VITEST: 'true',
    },
    environmentMatchGlobs: [
      ['src/server/**', 'node'],
      ['src/scripts/**', 'node'],
    ],
    define: {
      'process.env.NODE_ENV': JSON.stringify('test'),
    },
  },
});
