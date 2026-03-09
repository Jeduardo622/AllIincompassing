process.env.NODE_ENV = 'development';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'npm:zod@3.23.8': 'zod',
    },
  },
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
      include: [
        'src/lib/authStubSession.ts',
        'src/server/routes/guards.ts',
        'src/preview/config.ts',
      ],
      exclude: [
        'node_modules/',
        'src/test/',
        'src/**/*.test.*',
        'src/**/__tests__/**',
        'tests/**',
        'cypress/**',
        'dist/**',
        'tmp/**',
        'audit/**',
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
      ['tests/edge/**', 'node'],
      ['src/lib/__tests__/schedulingOrchestrator.test.ts', 'node'],
    ],
    define: {
      'process.env.NODE_ENV': JSON.stringify('test'),
    },
  },
});
