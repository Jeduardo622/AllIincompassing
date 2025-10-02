# Lighthouse follow-up

## Summary
- **Baseline (user-provided)** – FCP ≈ 2.0s, LCP ≈ 2.17s, SI ≈ 2.26s, CLS < 0.1, TBT < 200ms, HTTPS/Viewport passing, no service worker.
- **Post-change local run** – The bundled production preview now registers the new service worker and precaches the shell, but Lighthouse CLI could not compute paint-based metrics because the runtime Supabase configuration endpoint returns a development error in this container. The CLI therefore reported `NO_FCP` while still confirming the PWA checks (manifest + SW) inside `reports/lighthouse-after.json`.

## Verification notes
- Service worker: `public/sw.js` precaches `/`, `/index.html`, `/offline.html`, `/manifest.webmanifest` and handles runtime caching strategies for fonts, hashed assets, JSON APIs, and static images. The worker auto-updates thanks to `skipWaiting` and cache versioning. Registration occurs in `src/main.tsx` once the Supabase runtime config succeeds, and a waiting worker posts a `SKIP_WAITING` message to avoid stale caches.
- Offline coverage: Visiting `/offline.html` while offline delivers the branded fallback page. Navigation requests are served from the cached shell when the network is unavailable.
- Start URL control: the cached `/index.html` is re-served for the root navigation, ensuring both `/` and the manifest `start_url` stay under SW control.
- LCP optimisation: `index.html` now preloads `/api/runtime-config` so the gatekeeping fetch completes in parallel with bundler hydration, and `src/main.tsx` imports the app bundle alongside the config fetch to avoid sequential waits. The runtime error view now has fixed dimensions to prevent late layout shifts when the Supabase call fails.

## Next steps
- Re-run Lighthouse against a fully configured preview (Netlify or production) once the Supabase runtime configuration endpoint responds with valid data. The workflow in `.github/workflows/lighthouse.yml` automates this with budgets for LCP (≤ 2.5s mobile), CLS (≤ 0.1), TBT (≤ 300ms), and service worker presence.
- Monitor initial deploys to confirm that the service worker cache warms correctly and that `/offline.html` renders as expected on mobile devices.
