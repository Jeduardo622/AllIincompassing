export async function registerServiceWorker(): Promise<void> {
  if (typeof window === 'undefined') {
    return;
  }

  const isLocalhost = Boolean(
    window.location.hostname === 'localhost' ||
      window.location.hostname === '[::1]' ||
      window.location.hostname.match(/^127(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d?\d)){3}$/),
  );

  if (!('serviceWorker' in navigator) || import.meta.env.DEV) {
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
