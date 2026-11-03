/** 2D camera over an infinite grid. World units = cells; cell (x, y) is centred on (x, y). */
export class Camera {
  /** world coordinate at the centre of the viewport */
  cx = 0;
  cy = 0;
  /** CSS pixels per cell */
  scale = 44;
  width = 1;
  height = 1;

  static readonly MIN = 14;
  static readonly MAX = 120;

  private tween: {
    from: [number, number, number];
    to: [number, number, number];
    t0: number;
    dur: number;
  } | null = null;

  resize(w: number, h: number) {
    this.width = w;
    this.height = h;
  }

  toScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.cx) * this.scale + this.width / 2, (wy - this.cy) * this.scale + this.height / 2];
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.width / 2) / this.scale + this.cx, (sy - this.height / 2) / this.scale + this.cy];
  }

  cellAt(sx: number, sy: number): { x: number; y: number } {
    const [wx, wy] = this.toWorld(sx, sy);
    return { x: Math.round(wx), y: Math.round(wy) };
  }

  panBy(dxPx: number, dyPx: number) {
    this.tween = null;
    this.cx -= dxPx / this.scale;
    this.cy -= dyPx / this.scale;
  }

  /** Zoom keeping the world point under (sx, sy) fixed on screen. */
  zoomAt(factor: number, sx = this.width / 2, sy = this.height / 2) {
    this.tween = null;
    const [wx, wy] = this.toWorld(sx, sy);
    this.scale = clamp(this.scale * factor, Camera.MIN, Camera.MAX);
    const [nx, ny] = this.toWorld(sx, sy);
    this.cx += wx - nx;
    this.cy += wy - ny;
  }

  animateTo(cx: number, cy: number, scale: number, dur = 450) {
    this.tween = {
      from: [this.cx, this.cy, this.scale],
      to: [cx, cy, clamp(scale, Camera.MIN, Camera.MAX)],
      t0: performance.now(),
      dur,
    };
  }

  /** Advance tweens; returns true while animating. */
  update(now: number): boolean {
    const t = this.tween;
    if (!t) return false;
    const k = Math.min(1, (now - t.t0) / t.dur);
    const e = 1 - Math.pow(1 - k, 3);
    this.cx = t.from[0] + (t.to[0] - t.from[0]) * e;
    this.cy = t.from[1] + (t.to[1] - t.from[1]) * e;
    this.scale = t.from[2] + (t.to[2] - t.from[2]) * e;
    if (k >= 1) this.tween = null;
    return true;
  }

  isVisible(x: number, y: number, margin = 0): boolean {
    const [sx, sy] = this.toScreen(x, y);
    const r = this.scale / 2 + margin;
    return sx > -r && sy > -r && sx < this.width + r && sy < this.height + r;
  }
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
