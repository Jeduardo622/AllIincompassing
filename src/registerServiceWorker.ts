export async function registerServiceWorker(): Promise<void> {
  if (typeof window === 'undefined') {
    return;
  }

  const hostname = window.location.hostname;
  const isLocalhost = Boolean(
    hostname === 'localhost' ||
      hostname === '[::1]' ||
      hostname.match(/^127(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d?\d)){3}$/),
  );
  const isNetlifyPreviewHost = hostname.endsWith('.netlify.app');

  if (!('serviceWorker' in navigator) || import.meta.env.DEV) {
    return;
  }

  if (isNetlifyPreviewHost) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
      if ('caches' in window) {
        const cacheKeys = await caches.keys();
        await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)));
      }
    } catch (error) {
      console.warn('[PWA] Failed to disable service worker on Netlify preview host', error);
    }
    return;
  }

  const swUrl = '/sw.js';

  try {
    const registration = await navigator.serviceWorker.register(swUrl, { scope: '/' });

    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (isLocalhost) {
        console.info('[PWA] Controller changed, reloading to activate new service worker');
      }
      window.location.reload();
    });
  } catch (error) {
    console.error('[PWA] Service worker registration failed', error);
  }
}

export function unregisterServiceWorker(): void {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  navigator.serviceWorker.ready
    .then((registration) => {
      registration.unregister().catch((error) => {
        console.error('[PWA] Failed to unregister service worker', error);
      });
    })
    .catch(() => {
      // Intentionally swallow errors caused by readiness race conditions
    });
}
