import './styles.css';
import { App } from './app';
import { isEmbedded, onlineEnabled } from './runtimeConfig';

// Inside an <iframe>: lets CSS tweak the layout (see .embedded in styles.css).
if (isEmbedded()) document.documentElement.classList.add('embedded');

const app = new App();
// Handy for debugging in the console.
(window as unknown as { app: App }).app = app;

/**
 * Invite links open the online hub straight into a room:
 *   https://game/#/r/ABC123      (normal link)
 *   https://game/?room=ABC123    (handy for <iframe src>, see docs/DEPLOY.md)
 */
function handleInvite() {
  if (!onlineEnabled() || app.hub.room) return;
  const fromHash = location.hash.match(/^#\/r\/([A-Za-z0-9]{6})$/)?.[1];
  const fromQuery = new URLSearchParams(location.search).get('room');
  const code = fromHash ?? (fromQuery && /^[A-Za-z0-9]{6}$/.test(fromQuery) ? fromQuery : null);
  if (code) void app.hub.openWithCode(code.toUpperCase());
}
window.addEventListener('hashchange', handleInvite);
handleInvite();

// Let an embedding page know the game is ready (optional to listen for).
if (isEmbedded()) {
  try {
    window.parent.postMessage({ source: 'infinite-xo', type: 'ready' }, '*');
  } catch {
    /* ignore */
  }
}
