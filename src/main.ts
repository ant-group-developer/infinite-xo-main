import './styles.css';
import { App } from './app';

const app = new App();
// Handy for debugging in the console.
(window as unknown as { app: App }).app = app;

// Invite links: https://…/#/r/ABC123 opens the online hub straight into that room.
function handleHash() {
  const m = location.hash.match(/^#\/r\/([A-Za-z0-9]{6})$/);
  if (m && !app.hub.room) void app.hub.openWithCode(m[1].toUpperCase());
}
window.addEventListener('hashchange', handleHash);
handleHash();
