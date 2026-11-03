import { sfx } from '../audio';

export interface ModalButton {
  label: string;
  kind?: 'primary' | 'danger';
  onClick?: () => void;
}

export interface ModalOptions {
  title: string;
  body?: string;
  bodyCenter?: boolean;
  tone?: 'win' | 'lose' | 'draw' | 'info';
  buttons: ModalButton[];
  /** click on backdrop / Esc closes (default true) */
  dismissible?: boolean;
  onDismiss?: () => void;
}

const overlay = () => document.getElementById('overlay')!;
let escHandler: ((e: KeyboardEvent) => void) | null = null;
let closedAt = 0;
/** True briefly after a modal closes, so the closing click never lands on the board. */
export const justClosed = () => performance.now() - closedAt < 350;

export function closeModal() {
  const o = overlay();
  if (o.classList.contains('open')) closedAt = performance.now();
  o.classList.remove('open');
  o.innerHTML = '';
  o.onclick = null;
  if (escHandler) document.removeEventListener('keydown', escHandler);
  escHandler = null;
}

export const isModalOpen = () => overlay().classList.contains('open');

export function showModal(opts: ModalOptions) {
  closeModal();
  const o = overlay();
  const m = document.createElement('div');
  m.className = `modal ${opts.tone ?? 'info'}`;
  m.setAttribute('role', 'dialog');
  m.setAttribute('aria-modal', 'true');
  m.innerHTML = `<h2></h2>${opts.body ? `<div class="mbody${opts.bodyCenter ? ' center' : ''}">${opts.body}</div>` : ''}<div class="btns"></div>`;
  m.querySelector('h2')!.textContent = opts.title;
  const btns = m.querySelector('.btns')!;
  for (const b of opts.buttons) {
    const el = document.createElement('button');
    el.textContent = b.label;
    if (b.kind) el.className = b.kind;
    el.onclick = () => {
      sfx.click();
      closeModal();
      b.onClick?.();
    };
    btns.appendChild(el);
  }
  o.appendChild(m);
  o.classList.add('open');
  (btns.querySelector<HTMLButtonElement>('.primary') ?? btns.querySelector<HTMLButtonElement>('button'))?.focus();

  const dismissible = opts.dismissible ?? true;
  if (dismissible) {
    o.onclick = (e) => {
      if (e.target === o) {
        closeModal();
        opts.onDismiss?.();
      }
    };
    escHandler = (e) => {
      if (e.key === 'Escape') {
        closeModal();
        opts.onDismiss?.();
      }
    };
    document.addEventListener('keydown', escHandler);
  }
  return m;
}

let toastTimer = 0;
export function toast(msg: string, ms = 1600) {
  const el = document.getElementById('toast')!;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), ms);
}
