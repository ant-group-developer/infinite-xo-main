import './styles.css';
import { App } from './app';

const app = new App();
// Handy for debugging in the console.
(window as unknown as { app: App }).app = app;
