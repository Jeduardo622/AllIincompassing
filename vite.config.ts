import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Vendor chunks
          if (id.includes('node_modules')) {
            if (id.includes('react') && !id.includes('react-router')) {
              return 'vendor';
            }
            if (id.includes('react-router')) {
              return 'router';
            }
            if (id.includes('@tanstack/react-query')) {
              return 'query';
            }
            if (id.includes('@headlessui') || id.includes('lucide-react')) {
              return 'ui';
            }
            if (id.includes('react-hook-form')) {
              return 'forms';
            }
            if (id.includes('date-fns')) {
              return 'dates';
            }
            if (id.includes('geolib')) {
              return 'maps';
            }
            if (id.includes('@supabase')) {
              return 'supabase';
            }
          }
          
          // Feature chunks
          if (id.includes('src/lib/autoSchedule') || id.includes('src/lib/scheduling')) {
            return 'scheduling';
          }
          if (id.includes('src/pages/Reports') || id.includes('src/components/reports')) {
            return 'reports';
          }
          if (id.includes('src/pages/Billing') || id.includes('src/components/billing')) {
            return 'billing';
          }
        }
      }
    },
    chunkSizeWarningLimit: 1000,
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: false,
  },
  server: {
    fs: {
      strict: false
    }
  }
});