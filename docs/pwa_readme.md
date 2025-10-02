# PWA Operations Runbook

This document explains how the AllIncompassing web client registers its Progressive Web App (PWA) assets, how to test them locally, and what to do when a new deploy needs to invalidate previously cached resources.

## Local development

- `npm run dev` **does not register** the service worker. Vite’s dev server intentionally disables it so you can iterate without caching issues.
- To mimic the production experience locally:
  1. Build the app: `npm run build`.
  2. Serve the production bundle: `npm run preview -- --host 0.0.0.0 --port 4173`.
  3. Visit `http://127.0.0.1:4173` in a new browser profile (or an incognito window) and confirm that the service worker installs.
- If you ever need to disable the worker while using the preview server, call `unregisterServiceWorker()` in the browser console or use the Application tab in DevTools.

## Staging & production behaviour

- The worker is registered from `src/registerServiceWorker.ts` after the runtime Supabase configuration succeeds, ensuring that first paint is not delayed by PWA bootstrap.
- `public/sw.js` precaches the core shell (`/`, `/index.html`, `/offline.html`, `/manifest.webmanifest`) and provides runtime strategies:
  - `stale-while-revalidate` for fonts and static images.
  - `network-first` for JSON API responses (and `/api/*`).
  - `cache-first` for hashed assets emitted to `/assets/`.
- Navigation requests fall back to the cached shell and, if unavailable, the `offline.html` document. This ensures both the entry route and the `start_url` remain available while offline.
- Updates use cache versioning (`APP_VERSION`) plus `skipWaiting`/`clientsClaim` so a new deploy invalidates prior caches as soon as the next page load occurs.

## Version bumps & cache invalidation

- Update the `APP_VERSION` constant in `public/sw.js` whenever the precache list changes or when you need to force users onto a hotfix.
- Ship static assets with hashed filenames (already handled by Vite) so cache-first responses never serve stale code.
- After bumping the version, rebuild and redeploy; the next navigation event will activate the new worker automatically.

## Offline testing checklist

1. Run the preview server (`npm run preview`) and open the site in Chrome.
2. Use DevTools → Application → Service Workers to confirm the worker is active and controlling the page.
3. Toggle “Offline” in the Network panel and reload. You should see the offline fallback page.
4. Re-enable the network, trigger an update (e.g., modify any file and rebuild), and confirm the worker activates with the new `APP_VERSION`.

## Debugging tips

- Inspect cache contents via `caches.keys()` in the console to ensure obsolete versions are removed.
- Use `navigator.serviceWorker.getRegistrations()` to ensure only the expected worker is active.
- If a deploy seems stuck, call `navigator.serviceWorker.getRegistration()?.update()` to force a check.
- Lighthouse CI (`.github/workflows/lighthouse.yml`) runs on pull requests and will fail if the worker is missing, LCP > 2.5s (mobile), CLS > 0.1, or TBT exceeds the configured budget. Review the generated artifact in the workflow run for detailed traces.
