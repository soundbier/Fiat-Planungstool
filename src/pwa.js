// Service Worker: App-Shell (HTML, JS, CSS, Icons) offline verfügbar. Firestore-Daten cacht das SDK selbst.
import { registerSW } from 'virtual:pwa-register';
import { toast } from './ui.js';

export function initPwa() {
  if (!('serviceWorker' in navigator)) return;
  const update = registerSW({
    onNeedRefresh() {
      toast('Neue Version verfügbar', { label: 'Aktualisieren', run: () => update(true), sticky: true });
    },
    onRegisterError(e) { console.warn('Service Worker:', e); }
  });
}
