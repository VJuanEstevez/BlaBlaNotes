export const isStandalone =
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

let deferredInstallPrompt = null;

/**
 * Registers the offline-first service worker and wires the install and
 * connectivity events the UI reacts to. Registration is skipped on
 * `file://`, where service workers are unavailable by design.
 */
export function initPwa({
  onUpdateAvailable = () => {},
  onInstallAvailable = () => {},
  onInstalled = () => {},
  onOnline = () => {},
  onOffline = () => {},
} = {}) {
  window.addEventListener('online', () => onOnline());
  window.addEventListener('offline', () => onOffline());

  window.addEventListener('beforeinstallprompt', (event) => {
    // Chrome shows its own mini-infobar unless the event is captured.
    event.preventDefault();
    deferredInstallPrompt = event;
    onInstallAvailable();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    onInstalled();
  });

  if (!('serviceWorker' in navigator) || window.location.protocol === 'file:') return;

  // On a first visit the worker calls `clients.claim()`, which fires
  // `controllerchange` even though nothing was replaced. Only a page that was
  // already controlled needs to reload to pick up new code.
  const wasControlled = Boolean(navigator.serviceWorker.controller);

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((registration) => {
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (!worker) return;

          worker.addEventListener('statechange', () => {
            // A worker that reaches "installed" while another one controls the
            // page means new content is cached and waiting.
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              onUpdateAvailable(() => worker.postMessage({ type: 'SKIP_WAITING' }));
            }
          });
        });
      })
      .catch((error) => {
        console.warn('No se pudo registrar el Service Worker', error);
      });

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!wasControlled || reloading) return;
      reloading = true;
      window.location.reload();
    });
  });
}

export function canInstall() {
  return Boolean(deferredInstallPrompt);
}

/** Shows the browser's install prompt; resolves to true when accepted. */
export async function promptInstall() {
  if (!deferredInstallPrompt) return false;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  return outcome === 'accepted';
}
