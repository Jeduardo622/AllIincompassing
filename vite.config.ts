import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
  const isVitest = process.env.VITEST === 'true';

  return {
    plugins: [
      react(),
      {
        name: 'dev-runtime-config-endpoint',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            try {
              const url = req.url || '';
              if (!url.startsWith('/api/runtime-config')) {
                return next();
              }

              const { runtimeConfigHandler } = await server.ssrLoadModule('/src/server/api/runtime-config.ts');

              const targetUrl = new URL(url, 'http://localhost');
              const headers = new Headers();
              for (const [key, value] of Object.entries(req.headers)) {
                if (typeof value === 'string') headers.set(key, value);
                else if (Array.isArray(value)) headers.set(key, value.join(', '));
              }

              const request = new Request(targetUrl.toString(), { method: req.method, headers });
              const response: Response = await runtimeConfigHandler(request);

              res.statusCode = response.status;
              response.headers.forEach((value, key) => {
                res.setHeader(key, value);
              });
              const body = Buffer.from(await response.arrayBuffer());
              res.end(body);
            } catch (error) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Internal Server Error' }));
            }
          });
        },
      },
    ],
    define: {
      'import.meta.env.VITE_SUPABASE_URL': 'undefined',
      'import.meta.env.VITE_SUPABASE_ANON_KEY': 'undefined',
      'import.meta.env.VITE_SUPABASE_EDGE_URL': 'undefined',
      ...(isVitest ? { 'process.env.NODE_ENV': JSON.stringify('test') } : {}),
    },
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
          },
        },
      },
      chunkSizeWarningLimit: 1000,
      target: 'esnext',
      minify: 'esbuild',
      sourcemap: false,
    },
    server: {
      host: true,
      allowedHosts: ['host.docker.internal'],
      fs: {
        strict: false,
      },
    },
  };
});
