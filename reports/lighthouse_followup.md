# Lighthouse follow-up

## Summary
- **Baseline (user-provided)** – FCP ≈ 2.0s, LCP ≈ 2.17s, SI ≈ 2.26s, CLS < 0.1, TBT < 200ms, HTTPS/Viewport passing, no service worker.
- **Current Lighthouse artifact** – `reports/lighthouse-after.json` shows a `CHROME_INTERSTITIAL_ERROR` against `https://68dc2f30c25e8c00070327f2--velvety-cendol-dae4d6.netlify.app/`, with Chrome redirected to `chrome-error://chromewebdata/`. Paint-based metrics were not collected because the page never loaded normally, so this artifact is only useful for documenting the failed run condition.

## Verification notes
- Service worker: `public/sw.js` precaches `/`, `/index.html`, `/offline.html`, `/manifest.webmanifest` and handles runtime caching strategies for fonts, hashed assets, JSON APIs, and static images. The worker auto-updates thanks to `skipWaiting` and cache versioning. Registration occurs in `src/main.tsx` once the Supabase runtime config succeeds, and a waiting worker posts a `SKIP_WAITING` message to avoid stale caches.
- Offline coverage: Visiting `/offline.html` while offline delivers the branded fallback page. Navigation requests are served from the cached shell when the network is unavailable.
- Start URL control: the cached `/index.html` is re-served for the root navigation, ensuring both `/` and the manifest `start_url` stay under SW control.
- Artifact caveat: this local Lighthouse result does not prove current paint metrics or runtime-config health. It only proves the recorded run hit a navigation/interstitial failure before Lighthouse could score FCP, LCP, SI, TBT, or CLS.

## Next steps
- Re-run Lighthouse against a working preview URL that loads without a Chrome interstitial. Confirm the target preview is still live and that runtime-config/bootstrap requests succeed before treating any Lighthouse output as performance evidence.
- Monitor initial deploys to confirm that the service worker cache warms correctly and that `/offline.html` renders as expected on mobile devices.
