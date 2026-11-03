import { keyOf } from '../core/board';
import type { Game } from '../core/game';
import type { Cell, Move, Player } from '../core/types';
import type { BoardView } from '../view/BoardView';
import { Camera, clamp } from './camera';

export const PIECE_COLOR: Record<Player, string> = { X: '#ff2bd6', O: '#1ff4ff' };

const PLACE_MS = 320;
const WIN_BEAM_MS = 520;
const TAP_SLOP_TOUCH = 10;
const TAP_SLOP_MOUSE = 5;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

/**
 * Infinite-board renderer on a 2D canvas: neon pieces, pan / zoom / pinch,
 * hover preview, last-move marker, win beam, particles, off-screen arrow.
 */
export class CanvasView implements BoardView {
  onCellTap: ((cell: Cell) => void) | null = null;

  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private cam = new Camera();
  private dpr = 1;
  private raf = 0;
  private ro: ResizeObserver;
  private unsub: () => void;

  private interactive: Player | null = null;
  private hover: Cell | null = null;
  private hint: Cell | null = null;
  private placedAt = new Map<number, number>();
  private winAt = 0;
  private rejects: { cell: Cell; t0: number }[] = [];
  private particles: Particle[] = [];
  private sprites = new Map<string, HTMLCanvasElement>();

  // gesture state
  private pointers = new Map<number, { x: number; y: number; type: string }>();
  private gesture: { sx: number; sy: number; moved: boolean; pinchDist: number; midX: number; midY: number } | null =
    null;
  private vel = { x: 0, y: 0, t: 0 };
  private inertia = { x: 0, y: 0 };
  private arrowHit: { x: number; y: number; r: number } | null = null;

  constructor(
    private host: HTMLElement,
    private game: Game,
  ) {
    this.canvas.className = 'board-canvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'Board');
    host.appendChild(this.canvas);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();

    this.unsub = game.on((e) => {
      const now = performance.now();
      if (e.type === 'move') {
        this.placedAt.set(keyOf(e.move.x, e.move.y), now);
        this.hint = null;
        this.ensureVisible(e.move.x, e.move.y);
      } else if (e.type === 'win') {
        this.winAt = now;
        this.fitCells(e.line.cells, true);
        for (const c of e.line.cells) this.burst(c.x, c.y, PIECE_COLOR[e.winner], 14);
      } else if (e.type === 'reset') {
        this.placedAt.clear();
        this.particles.length = 0;
        this.winAt = 0;
        this.hint = null;
        this.recenter(true);
      } else if (e.type === 'undo') {
        for (const m of e.moves) this.placedAt.delete(keyOf(m.x, m.y));
        this.hint = null;
      }
    });

    this.bindInput();
    const loop = (t: number) => {
      this.frame(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /* ---------------------------------------------------------- public API */

  setInteractive(player: Player | null) {
    this.interactive = player;
    this.canvas.style.cursor = player ? 'pointer' : 'grab';
  }

  showHint(cell: Cell | null) {
    this.hint = cell;
    if (cell) this.ensureVisible(cell.x, cell.y);
  }

  recenter(animate = true) {
    const b = this.game.board.bounds();
    if (!b) {
      if (animate) this.cam.animateTo(0, 0, 46);
      else Object.assign(this.cam, { cx: 0, cy: 0, scale: 46 });
      return;
    }
    const cells = [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.maxY },
    ];
    this.fitCells(cells, animate);
  }

  zoomBy(factor: number) {
    const c = this.cam;
    c.animateTo(c.cx, c.cy, c.scale * factor, 200);
  }

  reject(cell: Cell) {
    this.rejects.push({ cell, t0: performance.now() });
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.unsub();
    this.canvas.remove();
  }

  /* ------------------------------------------------------------- camera */

  private resize() {
    const r = this.host.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    this.cam.resize(r.width, r.height);
  }

  private fitCells(cells: Cell[], animate: boolean) {
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const c of cells) {
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y);
      maxY = Math.max(maxY, c.y);
    }
    const pad = 3;
    const scale = clamp(
      Math.min(this.cam.width / (maxX - minX + 1 + pad * 2), this.cam.height / (maxY - minY + 1 + pad * 2)),
      22,
      56,
    );
    const cx = (minX + maxX) / 2,
      cy = (minY + maxY) / 2;
    if (animate) this.cam.animateTo(cx, cy, scale);
    else Object.assign(this.cam, { cx, cy, scale });
  }

  /** Keep a cell at least ~1.5 cells away from the viewport edge. */
  private ensureVisible(x: number, y: number) {
    const c = this.cam;
    const m = 1.5;
    const halfW = c.width / 2 / c.scale - m;
    const halfH = c.height / 2 / c.scale - m;
    let nx = c.cx,
      ny = c.cy;
    if (x < c.cx - halfW) nx = x + halfW - 1;
    if (x > c.cx + halfW) nx = x - halfW + 1;
    if (y < c.cy - halfH) ny = y + halfH - 1;
    if (y > c.cy + halfH) ny = y - halfH + 1;
    if (nx !== c.cx || ny !== c.cy) c.animateTo(nx, ny, c.scale, 380);
  }

  /* -------------------------------------------------------------- input */

  private bindInput() {
    const cv = this.canvas;
    cv.style.touchAction = 'none';
    const local = (e: PointerEvent | WheelEvent) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      const p = local(e);
      this.pointers.set(e.pointerId, { ...p, type: e.pointerType });
      this.inertia = { x: 0, y: 0 };
      if (this.pointers.size === 1) {
        this.gesture = { sx: p.x, sy: p.y, moved: false, pinchDist: 0, midX: p.x, midY: p.y };
        this.vel = { x: 0, y: 0, t: performance.now() };
      } else if (this.pointers.size === 2 && this.gesture) {
        const [a, b] = [...this.pointers.values()];
        this.gesture.moved = true;
        this.gesture.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        this.gesture.midX = (a.x + b.x) / 2;
        this.gesture.midY = (a.y + b.y) / 2;
      }
    });

    cv.addEventListener('pointermove', (e) => {
      const p = local(e);
      const prev = this.pointers.get(e.pointerId);
      if (!prev) {
        if (e.pointerType === 'mouse') this.hover = this.cam.cellAt(p.x, p.y);
        return;
      }
      this.pointers.set(e.pointerId, { ...p, type: e.pointerType });
      const g = this.gesture;
      if (!g) return;

      if (this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2,
          my = (a.y + b.y) / 2;
        if (g.pinchDist > 0) this.cam.zoomAt(dist / g.pinchDist, mx, my);
        this.cam.panBy(mx - g.midX, my - g.midY);
        g.pinchDist = dist;
        g.midX = mx;
        g.midY = my;
        return;
      }

      const slop = e.pointerType === 'mouse' ? TAP_SLOP_MOUSE : TAP_SLOP_TOUCH;
      if (!g.moved && Math.hypot(p.x - g.sx, p.y - g.sy) > slop) {
        g.moved = true;
        this.hover = null;
        cv.classList.add('dragging');
      }
      if (g.moved) {
        const dx = p.x - prev.x,
          dy = p.y - prev.y;
        this.cam.panBy(dx, dy);
        const now = performance.now();
        const dt = Math.max(16, now - this.vel.t);
        const MAXV = 2; // px per ms
        this.vel = {
          x: clamp(0.7 * (dx / dt) + 0.3 * this.vel.x, -MAXV, MAXV),
          y: clamp(0.7 * (dy / dt) + 0.3 * this.vel.y, -MAXV, MAXV),
          t: now,
        };
      } else if (e.pointerType === 'mouse') {
        this.hover = this.cam.cellAt(p.x, p.y);
      }
    });

    const end = (e: PointerEvent, cancelled: boolean) => {
      if (!this.pointers.has(e.pointerId)) return;
      const p = local(e);
      this.pointers.delete(e.pointerId);
      const g = this.gesture;
      if (this.pointers.size > 0) return; // still pinching
      this.gesture = null;
      cv.classList.remove('dragging');
      if (!g || cancelled) return;
      if (g.moved) {
        if (performance.now() - this.vel.t < 60) this.inertia = { x: this.vel.x * 12, y: this.vel.y * 12 };
        return;
      }
      // A tap.
      const a = this.arrowHit;
      if (a && Math.hypot(p.x - a.x, p.y - a.y) < a.r) {
        const last = this.game.lastMove;
        if (last) this.cam.animateTo(last.x, last.y, Math.max(this.cam.scale, 36));
        return;
      }
      this.onCellTap?.(this.cam.cellAt(p.x, p.y));
    };
    cv.addEventListener('pointerup', (e) => end(e, false));
    cv.addEventListener('pointercancel', (e) => end(e, true));
    cv.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.hover = null;
    });

    cv.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = local(e);
        const unit = e.deltaMode === 1 ? 16 : 1;
        this.cam.zoomAt(Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0018)), p.x, p.y);
      },
      { passive: false },
    );

    cv.addEventListener('keydown', (e) => {
      const step = 60;
      const map: Record<string, () => void> = {
        ArrowLeft: () => this.cam.panBy(step, 0),
        ArrowRight: () => this.cam.panBy(-step, 0),
        ArrowUp: () => this.cam.panBy(0, step),
        ArrowDown: () => this.cam.panBy(0, -step),
        '+': () => this.zoomBy(1.25),
        '=': () => this.zoomBy(1.25),
        '-': () => this.zoomBy(0.8),
        '0': () => this.recenter(),
        c: () => this.recenter(),
      };
      const fn = map[e.key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    });
  }

  /* ------------------------------------------------------------ drawing */

  private frame(now: number) {
    this.cam.update(now);
    if (Math.abs(this.inertia.x) + Math.abs(this.inertia.y) > 0.05 && this.pointers.size === 0) {
      this.cam.panBy(this.inertia.x, this.inertia.y);
      this.inertia.x *= 0.88;
      this.inertia.y *= 0.88;
    }

    const ctx = this.ctx;
    const { width: W, height: H } = this.cam;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    this.drawGrid();

    const g = this.game;
    const over = g.isOver;
    const winSet = new Set(g.winLine?.cells.map((c) => keyOf(c.x, c.y)));
    const last = g.lastMove;

    // last-move marker
    if (last && !over) this.drawCellGlow(last.x, last.y, PIECE_COLOR[last.p], 0.16 + 0.06 * Math.sin(now / 260));

    // hint
    if (this.hint) this.drawHint(this.hint, now);

    // hover ghost
    const h = this.hover;
    if (h && this.interactive && !over && !g.board.has(h.x, h.y) && this.pointers.size === 0) {
      ctx.globalAlpha = 0.28;
      this.drawPieceSprite(this.interactive, h.x, h.y, 1);
      ctx.globalAlpha = 1;
    }

    // pieces
    const sinceWin = now - this.winAt;
    for (const m of g.moves) {
      if (!this.cam.isVisible(m.x, m.y, this.cam.scale)) continue;
      const k = keyOf(m.x, m.y);
      const t0 = this.placedAt.get(k);
      const age = t0 === undefined ? Infinity : now - t0;
      const inWin = winSet.has(k);
      let alpha = 1,
        scale = 1;
      if (over && g.winLine && !inWin) alpha = 0.32;
      if (inWin && sinceWin < 2400) scale = 1 + 0.12 * Math.max(0, Math.sin((sinceWin / 2400) * Math.PI * 4));
      ctx.globalAlpha = alpha;
      if (age < PLACE_MS) this.drawPlacing(m, age / PLACE_MS);
      else this.drawPieceSprite(m.p, m.x, m.y, scale);
      ctx.globalAlpha = 1;
    }

    if (g.winLine && g.winner) this.drawWinBeam(now);
    this.drawRejects(now);
    this.drawParticles();
    this.drawOffscreenArrow(last);
  }

  private drawGrid() {
    const ctx = this.ctx;
    const c = this.cam;
    const [wx0, wy0] = c.toWorld(0, 0);
    const [wx1, wy1] = c.toWorld(c.width, c.height);
    const x0 = Math.floor(wx0) - 1,
      x1 = Math.ceil(wx1) + 1;
    const y0 = Math.floor(wy0) - 1,
      y1 = Math.ceil(wy1) + 1;
    const fade = clamp((c.scale - 10) / 26, 0.25, 1);

    ctx.lineWidth = 1;
    for (const major of [false, true]) {
      ctx.beginPath();
      for (let x = x0; x <= x1; x++) {
        const isMajor = (x + 2) % 5 === 0 || (x + 2) % 5 === -0;
        if (isMajor !== major) continue;
        const [sx] = c.toScreen(x + 0.5, 0);
        const px = Math.round(sx) + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, c.height);
      }
      for (let y = y0; y <= y1; y++) {
        const isMajor = (y + 2) % 5 === 0 || (y + 2) % 5 === -0;
        if (isMajor !== major) continue;
        const [, sy] = c.toScreen(0, y + 0.5);
        const py = Math.round(sy) + 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(c.width, py);
      }
      ctx.strokeStyle = major ? `rgba(160,130,255,${0.32 * fade})` : `rgba(138,107,255,${0.17 * fade})`;
      ctx.stroke();
    }

    // origin marker
    if (c.isVisible(0, 0)) {
      const [ox, oy] = c.toScreen(0, 0);
      ctx.fillStyle = 'rgba(185,169,255,0.18)';
      ctx.beginPath();
      ctx.arc(ox, oy, Math.max(2, c.scale * 0.07), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawCellGlow(x: number, y: number, color: string, alpha: number) {
    const ctx = this.ctx;
    const s = this.cam.scale;
    const [sx, sy] = this.cam.toScreen(x, y);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    roundRect(ctx, sx - s * 0.46, sy - s * 0.46, s * 0.92, s * 0.92, s * 0.18);
    ctx.fill();
    ctx.restore();
  }

  private drawHint(cell: Cell, now: number) {
    const ctx = this.ctx;
    const s = this.cam.scale;
    const [sx, sy] = this.cam.toScreen(cell.x, cell.y);
    const k = (now / 900) % 1;
    ctx.save();
    ctx.strokeStyle = '#ffd23a';
    ctx.shadowColor = '#ffd23a';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 1 - k;
    ctx.beginPath();
    ctx.arc(sx, sy, s * (0.25 + 0.35 * k), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(sx, sy, s * 0.12, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd23a';
    ctx.fill();
    ctx.restore();
  }

  /** Cached neon sprite for a piece at the current zoom (device pixels). */
  private sprite(p: Player): HTMLCanvasElement {
    const sizePx = Math.max(8, Math.round((this.cam.scale * this.dpr) / 4) * 4);
    const key = `${p}:${sizePx}`;
    let sp = this.sprites.get(key);
    if (sp) return sp;
    if (this.sprites.size > 24) this.sprites.clear();
    sp = document.createElement('canvas');
    const pad = sizePx * 0.5;
    sp.width = sp.height = Math.ceil(sizePx + pad * 2);
    sp.dataset.cell = String(sizePx);
    const c = sp.getContext('2d')!;
    paintPiece(c, p, sp.width / 2, sp.height / 2, sizePx, 1);
    this.sprites.set(key, sp);
    return sp;
  }

  private drawPieceSprite(p: Player, x: number, y: number, scale: number) {
    const sp = this.sprite(p);
    const [sx, sy] = this.cam.toScreen(x, y);
    // sprite = piece drawn for a cell of `sizePx` device px, padded by 50% each side (2x total)
    const w = sp.width * (this.cam.scale / Number(sp.dataset.cell)) * scale;
    this.ctx.drawImage(sp, sx - w / 2, sy - w / 2, w, w);
  }

  private drawPlacing(m: Move, k: number) {
    const [sx, sy] = this.cam.toScreen(m.x, m.y);
    // pop: 0.55 -> 1.12 -> 1
    const pop = k < 0.6 ? 0.55 + (1.12 - 0.55) * easeOut(k / 0.6) : 1.12 - 0.12 * easeOut((k - 0.6) / 0.4);
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(pop, pop);
    paintPiece(ctx, m.p, 0, 0, this.cam.scale, Math.min(1, k * 1.6));
    ctx.restore();
    if (k < 0.5) this.drawRipple(sx, sy, PIECE_COLOR[m.p], k / 0.5);
  }

  private drawRipple(sx: number, sy: number, color: string, k: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.45 * (1 - k);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, this.cam.scale * (0.3 + 0.5 * k), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawWinBeam(now: number) {
    const line = this.game.winLine!;
    const color = PIECE_COLOR[this.game.winner!];
    const k = easeOut(clamp((now - this.winAt) / WIN_BEAM_MS, 0, 1));
    const [dx, dy] = line.direction;
    const ext = 0.38;
    const [ax, ay] = this.cam.toScreen(line.start.x - dx * ext, line.start.y - dy * ext);
    const [bx, by] = this.cam.toScreen(line.end.x + dx * ext, line.end.y + dy * ext);
    const ex = ax + (bx - ax) * k,
      ey = ay + (by - ay) * k;
    const ctx = this.ctx;
    const s = this.cam.scale;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = s * 0.5;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = s * 0.16;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = s * 0.05;
    ctx.stroke();
    ctx.restore();
  }

  private drawRejects(now: number) {
    const ctx = this.ctx;
    this.rejects = this.rejects.filter((r) => now - r.t0 < 380);
    for (const r of this.rejects) {
      const k = (now - r.t0) / 380;
      const [sx, sy] = this.cam.toScreen(r.cell.x, r.cell.y);
      const shake = Math.sin(k * Math.PI * 6) * 4 * (1 - k);
      const s = this.cam.scale;
      ctx.save();
      ctx.globalAlpha = 0.6 * (1 - k);
      ctx.strokeStyle = '#ff4d6d';
      ctx.lineWidth = 3;
      roundRect(ctx, sx - s * 0.45 + shake, sy - s * 0.45, s * 0.9, s * 0.9, s * 0.18);
      ctx.stroke();
      ctx.restore();
    }
  }

  private burst(x: number, y: number, color: string, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 0.02 + Math.random() * 0.06;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 0.02,
        life: 0,
        max: 50 + Math.random() * 40,
        color: Math.random() < 0.3 ? '#ffd23a' : Math.random() < 0.5 ? '#fff' : color,
        size: 0.05 + Math.random() * 0.07,
      });
    }
  }

  private drawParticles() {
    const ctx = this.ctx;
    const s = this.cam.scale;
    this.particles = this.particles.filter((p) => p.life < p.max);
    for (const p of this.particles) {
      p.life++;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.0012;
      p.vx *= 0.985;
      const [sx, sy] = this.cam.toScreen(p.x, p.y);
      ctx.globalAlpha = 1 - p.life / p.max;
      ctx.fillStyle = p.color;
      ctx.fillRect(sx - (p.size * s) / 2, sy - (p.size * s) / 2, p.size * s, p.size * s);
    }
    ctx.globalAlpha = 1;
  }

  private drawOffscreenArrow(last: Move | null) {
    this.arrowHit = null;
    if (!last || this.cam.isVisible(last.x, last.y)) return;
    const c = this.cam;
    const [sx, sy] = c.toScreen(last.x, last.y);
    const cx = c.width / 2,
      cy = c.height / 2;
    const dx = sx - cx,
      dy = sy - cy;
    const inset = 26;
    const t = Math.min((c.width / 2 - inset) / Math.abs(dx || 1e-6), (c.height / 2 - inset) / Math.abs(dy || 1e-6));
    const ax = cx + dx * t,
      ay = cy + dy * t;
    const ang = Math.atan2(dy, dx);
    const color = PIECE_COLOR[last.p];
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.fillStyle = 'rgba(16,6,42,0.85)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(0, 0, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.rotate(ang);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(23, 0);
    ctx.lineTo(15, -6);
    ctx.lineTo(15, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(ax, ay);
    paintPiece(ctx, last.p, 0, 0, 22, 1, false);
    ctx.restore();
    this.arrowHit = { x: ax, y: ay, r: 26 };
  }
}

/* ------------------------------------------------------------- helpers */

/** Draw a neon X/O centred on (cx, cy). `size` = cell size; `progress` animates the stroke. */
export function paintPiece(
  ctx: CanvasRenderingContext2D,
  p: Player,
  cx: number,
  cy: number,
  size: number,
  progress: number,
  glow = true,
) {
  const color = PIECE_COLOR[p];
  const r = size * 0.27;
  const path = () => {
    ctx.beginPath();
    if (p === 'X') {
      const k1 = clamp(progress * 2, 0, 1);
      const k2 = clamp(progress * 2 - 1, 0, 1);
      ctx.moveTo(cx - r, cy - r);
      ctx.lineTo(cx - r + 2 * r * k1, cy - r + 2 * r * k1);
      if (k2 > 0) {
        ctx.moveTo(cx + r, cy - r);
        ctx.lineTo(cx + r - 2 * r * k2, cy - r + 2 * r * k2);
      }
    } else {
      const a0 = -Math.PI / 2;
      ctx.arc(cx, cy, r * 1.04, a0, a0 + Math.PI * 2 * clamp(progress, 0.001, 1));
    }
  };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (glow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = size * 0.32;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, size * 0.13);
  path();
  ctx.stroke();
  if (glow) ctx.stroke(); // second pass = stronger bloom
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.88)';
  ctx.lineWidth = Math.max(1, size * 0.042);
  path();
  ctx.stroke();
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
