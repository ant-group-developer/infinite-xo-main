import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { keyOf } from '../core/board';
import type { Game } from '../core/game';
import type { Cell, Move, Player, WinLine } from '../core/types';

/* ================================================================ themes */

export interface Theme3D {
  id: 'neon' | 'sunset' | 'ice';
  skyTop: number;
  skyHorizon: number;
  board: number;
  gridMinor: number;
  gridMajor: number;
  x: number;
  o: number;
  sunTop: number;
  sunBottom: number;
  beam: number;
}

export const THEMES: Record<Theme3D['id'], Theme3D> = {
  neon: {
    id: 'neon',
    skyTop: 0x05010f,
    skyHorizon: 0x3a0d6b,
    board: 0x12062c,
    gridMinor: 0x7a5cff,
    gridMajor: 0xb58cff,
    x: 0xff2bd6,
    o: 0x1ff4ff,
    sunTop: 0xffd23a,
    sunBottom: 0xff2bd6,
    beam: 0xffffff,
  },
  sunset: {
    id: 'sunset',
    skyTop: 0x140321,
    skyHorizon: 0xb4325a,
    board: 0x1c0820,
    gridMinor: 0xff7a59,
    gridMajor: 0xffc06a,
    x: 0xff3d7f,
    o: 0xffd23a,
    sunTop: 0xfff1a8,
    sunBottom: 0xff4d6d,
    beam: 0xfff3d6,
  },
  ice: {
    id: 'ice',
    skyTop: 0x020814,
    skyHorizon: 0x0c3a5c,
    board: 0x06172a,
    gridMinor: 0x2fa8ff,
    gridMajor: 0x9be7ff,
    x: 0x7cf8ff,
    o: 0xc9a2ff,
    sunTop: 0xe8fbff,
    sunBottom: 0x2fa8ff,
    beam: 0xffffff,
  },
};

export type CameraPreset = 'tilt' | 'top' | 'cinema';

/* ============================================================== helpers */

const PIECE_Y = 0.09;
const DROP_MS = 460;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
function easeOutBounce(t: number) {
  const n = 7.5625,
    d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}
const col = (hex: number) => new THREE.Color(hex);

type Anim = (now: number) => boolean; // return false when finished

/* ============================================================ the board */

/**
 * Three.js renderer for the infinite board. Reads the core Game (events) and
 * reports taps, exactly like the 2D CanvasView — so it can become a
 * BoardView implementation later.
 */
export class ThreeBoard {
  onCellTap: ((cell: Cell) => void) | null = null;

  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: MapControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private bloomOn = true;

  private theme: Theme3D = THEMES.neon;
  private gridMat!: THREE.ShaderMaterial;
  private grid!: THREE.Mesh;
  private sky!: THREE.Mesh;
  private sun!: THREE.Mesh;
  private stars!: THREE.Points;
  private follow = new THREE.Group(); // things that follow the camera target (sky, sun, grid)

  private geo = {
    xBar: new THREE.CapsuleGeometry(0.075, 0.62, 6, 14),
    o: new THREE.TorusGeometry(0.255, 0.07, 18, 64),
    ring: new THREE.RingGeometry(0.34, 0.4, 64),
    cell: new THREE.PlaneGeometry(0.9, 0.9),
    beam: new THREE.CylinderGeometry(1, 1, 1, 16, 1, true),
  };
  private mats!: Record<Player, { normal: THREE.MeshStandardMaterial; dim: THREE.MeshStandardMaterial; ghost: THREE.MeshBasicMaterial }>;

  private pieces = new Map<number, THREE.Group>();
  private anims: Anim[] = [];
  private ghost: Record<Player, THREE.Group> | null = null;
  private highlight!: THREE.Mesh;
  private lastRing!: THREE.Mesh;
  private winGroup: THREE.Group | null = null;
  private interactive: Player | null = 'X';
  private hover: Cell | null = null;

  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private down: { x: number; y: number; t: number } | null = null;
  private raf = 0;
  private unsub: () => void;
  private ro: ResizeObserver;

  /** live numbers for the prototype HUD */
  readonly stats = { fps: 0, calls: 0, triangles: 0, pieces: 0 };
  private frames = 0;
  private fpsT0 = performance.now();

  constructor(
    private host: HTMLElement,
    private game: Game,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.info.autoReset = false;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 600);
    this.camera.position.set(0, 13, 11);

    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = false; // pan along the board
    this.controls.minDistance = 4;
    this.controls.maxDistance = 45;
    this.controls.minPolarAngle = 0.02;
    this.controls.maxPolarAngle = 1.34; // low enough to see the horizon, never under the board
    this.controls.target.set(0, 0, 0);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.45, 0.5);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.buildLights();
    this.buildWorld();
    this.buildMaterials();
    this.buildHelpers();
    this.scene.add(this.follow);
    this.setTheme('neon');

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.bindInput();

    for (const m of game.moves) this.addPiece(m, false);
    this.unsub = game.on((e) => {
      if (e.type === 'move') this.addPiece(e.move, true);
      else if (e.type === 'win') this.showWin(e.line, e.winner);
      else if (e.type === 'reset') this.clear();
      else if (e.type === 'undo') for (const m of e.moves) this.removePiece(m);
    });

    const loop = (now: number) => {
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /* -------------------------------------------------------------- setup */

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x8a6bff, 0x0a0420, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(-6, 12, 8);
    this.scene.add(key);
  }

  private buildWorld() {
    // Sky dome: vertical gradient, follows the camera target so the world feels endless.
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uTop: { value: col(0) }, uHorizon: { value: col(0) } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; varying vec3 vDir;
        void main(){ float h = clamp(vDir.y * 2.2, 0.0, 1.0); gl_FragColor = vec4(mix(uHorizon, uTop, pow(h, 0.6)), 1.0); }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat);
    this.follow.add(this.sky);

    // Synthwave sun with horizontal cut-outs, far behind the board.
    const sunMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTop: { value: col(0) }, uBottom: { value: col(0) }, uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uTop; uniform vec3 uBottom; uniform float uTime; varying vec2 vUv;
        void main(){
          vec2 p = vUv - 0.5; float r = length(p); if (r > 0.5) discard;
          float y = vUv.y;
          float band = step(0.5, fract((y + uTime * 0.03) * 14.0));
          float cut = (y < 0.45) ? band : 1.0;
          if (cut < 0.5) discard;
          vec3 c = mix(uBottom, uTop, smoothstep(0.0, 1.0, y));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(56, 56), sunMat);
    this.sun.position.set(0, 12, -260);
    this.follow.add(this.sun);

    // Stars
    const n = 900;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.random() * 0.45 * Math.PI;
      const r = 350;
      pos.set([r * Math.cos(th) * Math.sin(Math.PI / 2 - ph), r * Math.sin(ph) + 10, r * Math.sin(th) * Math.sin(Math.PI / 2 - ph)], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0.75 }));
    this.follow.add(this.stars);

    // Infinite grid: one big plane that follows the camera target (snapped to whole cells).
    this.gridMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uBase: { value: col(0) },
        uMinor: { value: col(0) },
        uMajor: { value: col(0) },
        uCenter: { value: new THREE.Vector2() },
        uRadius: { value: 40 },
        uHorizon: { value: col(0) },
      },
      vertexShader: `varying vec3 vWorld; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform vec3 uBase; uniform vec3 uMinor; uniform vec3 uMajor; uniform vec3 uHorizon;
        uniform vec2 uCenter; uniform float uRadius; varying vec3 vWorld;
        float lines(vec2 p, float s){ vec2 c = p / s; vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c); return 1.0 - min(min(g.x, g.y), 1.0); }
        void main(){
          vec2 p = vWorld.xz + 0.5;                 // cell borders between integer cells
          float minor = lines(p, 1.0);
          float major = lines(p + 2.0, 5.0);        // a brighter line every 5 cells
          float d = distance(vWorld.xz, uCenter);
          float fade = 1.0 - smoothstep(uRadius * 0.2, uRadius * 0.85, d);
          vec3 c = uBase + uMinor * minor * 0.32 + uMajor * major * 0.55;
          c = mix(uHorizon * 0.35, c, fade);         // melt into the horizon haze
          gl_FragColor = vec4(c, 1.0 - smoothstep(uRadius * 0.9, uRadius * 1.6, d)); // edges in ascending order (GLSL requires it)
        }`,
    });
    this.grid = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), this.gridMat);
    this.grid.rotation.x = -Math.PI / 2;
    this.scene.add(this.grid);
  }

  private buildMaterials() {
    const mk = (hex: number) => ({
      normal: new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.85, roughness: 0.35, metalness: 0.1 }),
      dim: new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.25, roughness: 0.5, transparent: true, opacity: 0.45 }),
      ghost: new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.28, depthWrite: false }),
    });
    this.mats = { X: mk(this.theme.x), O: mk(this.theme.o) };
  }

  private buildHelpers() {
    this.highlight = new THREE.Mesh(
      this.geo.cell,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false }),
    );
    this.highlight.rotation.x = -Math.PI / 2;
    this.highlight.position.y = 0.004;
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    this.lastRing = new THREE.Mesh(
      this.geo.ring,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.lastRing.rotation.x = -Math.PI / 2;
    this.lastRing.position.y = 0.006;
    this.lastRing.visible = false;
    this.scene.add(this.lastRing);

    this.ghost = { X: this.makePiece('X', true), O: this.makePiece('O', true) };
    for (const g of Object.values(this.ghost)) {
      g.visible = false;
      this.scene.add(g);
    }
  }

  private makePiece(p: Player, ghost = false): THREE.Group {
    const g = new THREE.Group();
    const mat = ghost ? this.mats[p].ghost : this.mats[p].normal;
    if (p === 'X') {
      for (const a of [Math.PI / 4, -Math.PI / 4]) {
        const holder = new THREE.Group();
        holder.rotation.y = a;
        const bar = new THREE.Mesh(this.geo.xBar, mat);
        bar.rotation.x = Math.PI / 2; // capsule lies flat on the board
        holder.add(bar);
        g.add(holder);
      }
    } else {
      const ring = new THREE.Mesh(this.geo.o, mat);
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
    }
    g.position.y = PIECE_Y;
    g.userData.player = p;
    return g;
  }

  private setPieceMaterial(g: THREE.Group, m: THREE.Material) {
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = m;
    });
  }

  /* --------------------------------------------------------- public API */

  setTheme(id: Theme3D['id']) {
    const t = (this.theme = THEMES[id]);
    (this.sky.material as THREE.ShaderMaterial).uniforms.uTop.value.set(t.skyTop);
    (this.sky.material as THREE.ShaderMaterial).uniforms.uHorizon.value.set(t.skyHorizon);
    (this.sun.material as THREE.ShaderMaterial).uniforms.uTop.value.set(t.sunTop);
    (this.sun.material as THREE.ShaderMaterial).uniforms.uBottom.value.set(t.sunBottom);
    const u = this.gridMat.uniforms;
    u.uBase.value.set(t.board);
    u.uMinor.value.set(t.gridMinor);
    u.uMajor.value.set(t.gridMajor);
    u.uHorizon.value.set(t.skyHorizon);
    this.scene.fog = new THREE.Fog(t.skyHorizon, 30, 120);
    for (const p of ['X', 'O'] as Player[]) {
      const hex = p === 'X' ? t.x : t.o;
      const m = this.mats[p];
      for (const mm of [m.normal, m.dim]) {
        mm.color.set(hex);
        mm.emissive.set(hex);
      }
      m.ghost.color.set(hex);
    }
  }

  setBloom(on: boolean) {
    this.bloomOn = on;
  }

  setInteractive(p: Player | null) {
    this.interactive = p;
  }

  setCameraPreset(preset: CameraPreset, animate = true) {
    const polar = preset === 'top' ? 0.03 : preset === 'cinema' ? 1.3 : 0.78;
    const dist = preset === 'top' ? 20 : preset === 'cinema' ? 12 : 17;
    const azim = preset === 'cinema' ? 0.55 : 0;
    this.flyTo(this.controls.target.clone(), dist, polar, azim, animate ? 700 : 0);
  }

  /** Fit the camera to all stones. */
  recenter() {
    const b = this.game.board.bounds();
    if (!b) return this.flyTo(new THREE.Vector3(0, 0, 0), 17, 0.78, 0, 600);
    const cx = (b.minX + b.maxX) / 2,
      cz = (b.minY + b.maxY) / 2;
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY) + 6;
    const sph = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    this.flyTo(new THREE.Vector3(cx, 0, cz), Math.max(9, Math.min(40, span * 1.35)), sph.phi, sph.theta, 600);
  }

  /** Place a decorative stone without touching the game (stress test). */
  addStatic(x: number, y: number, p: Player) {
    this.addPiece({ x, y, p }, false);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.unsub();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  /* ------------------------------------------------------------ pieces */

  private addPiece(m: Move, animate: boolean) {
    const k = keyOf(m.x, m.y);
    if (this.pieces.has(k)) return;
    const g = this.makePiece(m.p);
    g.position.set(m.x, PIECE_Y, m.y);
    this.scene.add(g);
    this.pieces.set(k, g);
    this.stats.pieces = this.pieces.size;
    this.lastRing.visible = true;
    this.lastRing.position.set(m.x, 0.006, m.y);
    (this.lastRing.material as THREE.MeshBasicMaterial).color.set(m.p === 'X' ? this.theme.x : this.theme.o);
    if (!animate) return;

    const t0 = performance.now();
    g.position.y = 2.4;
    g.scale.setScalar(0.6);
    g.rotation.y = m.p === 'O' ? 0 : -0.6;
    this.anims.push((now) => {
      const k = Math.min(1, (now - t0) / DROP_MS);
      g.position.y = PIECE_Y + (1 - easeOutBounce(k)) * 2.3;
      g.scale.setScalar(0.6 + 0.4 * easeOutCubic(k));
      if (m.p === 'X') g.rotation.y = -0.6 * (1 - easeOutCubic(k));
      return k < 1;
    });
    // ripple when it lands
    setTimeout(() => this.ripple(m.x, m.y, m.p === 'X' ? this.theme.x : this.theme.o), DROP_MS * 0.35);
  }

  private removePiece(m: Move) {
    const k = keyOf(m.x, m.y);
    const g = this.pieces.get(k);
    if (g) this.scene.remove(g);
    this.pieces.delete(k);
    this.stats.pieces = this.pieces.size;
  }

  private clear() {
    for (const g of this.pieces.values()) this.scene.remove(g);
    this.pieces.clear();
    this.stats.pieces = 0;
    this.lastRing.visible = false;
    if (this.winGroup) this.scene.remove(this.winGroup);
    this.winGroup = null;
    for (const p of ['X', 'O'] as Player[]) this.mats[p].normal.emissiveIntensity = 0.85;
  }

  private ripple(x: number, y: number, hex: number) {
    const mat = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    const r = new THREE.Mesh(this.geo.ring, mat);
    r.rotation.x = -Math.PI / 2;
    r.position.set(x, 0.01, y);
    this.scene.add(r);
    const t0 = performance.now();
    this.anims.push((now) => {
      const k = Math.min(1, (now - t0) / 600);
      r.scale.setScalar(0.7 + 1.6 * easeOutCubic(k));
      mat.opacity = 0.8 * (1 - k);
      if (k >= 1) {
        this.scene.remove(r);
        mat.dispose();
      }
      return k < 1;
    });
  }

  /* --------------------------------------------------------------- win */

  private showWin(line: WinLine, winner: Player) {
    const inLine = new Set(line.cells.map((c) => keyOf(c.x, c.y)));
    for (const [k, g] of this.pieces) {
      const p = g.userData.player as Player;
      this.setPieceMaterial(g, inLine.has(k) ? this.mats[p].normal : this.mats[p].dim);
    }
    this.lastRing.visible = false;

    const group = (this.winGroup = new THREE.Group());
    this.scene.add(group);
    const [dx, dy] = line.direction;
    const a = new THREE.Vector3(line.start.x - dx * 0.45, 0.12, line.start.y - dy * 0.45);
    const b = new THREE.Vector3(line.end.x + dx * 0.45, 0.12, line.end.y + dy * 0.45);
    const dir = b.clone().sub(a);
    const len = dir.length();
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    const hex = winner === 'X' ? this.theme.x : this.theme.o;
    const core = new THREE.Mesh(this.geo.beam, new THREE.MeshBasicMaterial({ color: this.theme.beam }));
    const glow = new THREE.Mesh(this.geo.beam, new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.55, depthWrite: false }));
    for (const [m, r] of [
      [core, 0.035],
      [glow, 0.11],
    ] as const) {
      m.quaternion.copy(quat);
      m.scale.set(r, 0.0001, r);
      group.add(m);
    }

    // particles burst from every winning cell
    const count = line.cells.length * 26;
    const pos = new Float32Array(count * 3);
    const vel: THREE.Vector3[] = [];
    line.cells.forEach((c, ci) => {
      for (let i = 0; i < 26; i++) {
        const j = (ci * 26 + i) * 3;
        pos[j] = c.x;
        pos[j + 1] = 0.2;
        pos[j + 2] = c.y;
        vel.push(new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3));
      }
    });
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pm = new THREE.PointsMaterial({ color: hex, size: 0.09, transparent: true, opacity: 1, depthWrite: false });
    group.add(new THREE.Points(pg, pm));

    const winners = line.cells.map((c) => this.pieces.get(keyOf(c.x, c.y))).filter(Boolean) as THREE.Group[];
    const t0 = performance.now();
    let last = t0;
    this.anims.push((now) => {
      const t = (now - t0) / 1000;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const k = easeOutCubic(Math.min(1, t / 0.55));
      const p = a.clone().lerp(b, k);
      const half = a.clone().add(p).multiplyScalar(0.5);
      for (const [m, r] of [
        [core, 0.035],
        [glow, 0.11 + 0.03 * Math.sin(t * 8)],
      ] as const) {
        m.position.copy(k >= 1 ? mid : half);
        m.scale.set(r, Math.max(0.0001, len * k), r);
      }
      // winning stones hop + spin, staggered
      winners.forEach((g, i) => {
        const w = Math.max(0, Math.sin((t - i * 0.08) * 6));
        g.position.y = PIECE_Y + (t < 2.2 ? w * 0.35 : 0);
        g.rotation.y += dt * (t < 2.2 ? 4 : 0.6);
      });
      // particles
      const arr = pg.attributes.position.array as Float32Array;
      for (let i = 0; i < vel.length; i++) {
        vel[i].y -= 6 * dt;
        arr[i * 3] += vel[i].x * dt;
        arr[i * 3 + 1] = Math.max(0.02, arr[i * 3 + 1] + vel[i].y * dt);
        arr[i * 3 + 2] += vel[i].z * dt;
      }
      pg.attributes.position.needsUpdate = true;
      pm.opacity = Math.max(0, 1 - t / 2);
      return this.winGroup === group; // keeps the slow idle spin while the result is shown
    });

    // Camera: fly to frame the whole line.
    const sph = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    this.flyTo(new THREE.Vector3(mid.x, 0, mid.z), Math.max(9, len * 1.6), Math.min(sph.phi, 0.95), sph.theta, 800);
  }

  /* ------------------------------------------------------------- camera */

  private flyTo(target: THREE.Vector3, dist: number, phi: number, theta: number, ms: number) {
    const fromT = this.controls.target.clone();
    const fromS = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(fromT));
    const toS = new THREE.Spherical(dist, phi, theta);
    // shortest way round
    let dTheta = toS.theta - fromS.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    const t0 = performance.now();
    const apply = (k: number) => {
      const s = new THREE.Spherical(
        fromS.radius + (toS.radius - fromS.radius) * k,
        fromS.phi + (toS.phi - fromS.phi) * k,
        fromS.theta + dTheta * k,
      );
      this.controls.target.lerpVectors(fromT, target, k);
      this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(s));
    };
    if (ms <= 0) return apply(1);
    this.anims.push((now) => {
      const k = Math.min(1, (now - t0) / ms);
      apply(easeOutCubic(k));
      return k < 1;
    });
  }

  /* -------------------------------------------------------------- input */

  private cellAt(clientX: number, clientY: number): Cell | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.plane, hit)) return null;
    return { x: Math.round(hit.x), y: Math.round(hit.z) };
  }

  private bindInput() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    el.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!d || e.button !== 0) return;
      const slop = e.pointerType === 'mouse' ? 5 : 10;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > slop) return; // that was a drag (pan)
      const c = this.cellAt(e.clientX, e.clientY);
      if (c) this.onCellTap?.(c);
    });
    el.addEventListener('pointermove', (e) => {
      this.hover = e.pointerType === 'mouse' ? this.cellAt(e.clientX, e.clientY) : null;
    });
    el.addEventListener('pointerleave', () => (this.hover = null));
  }

  /* -------------------------------------------------------------- frame */

  private resize() {
    const r = this.host.getBoundingClientRect();
    const w = Math.max(1, r.width),
      h = Math.max(1, r.height);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame(now: number) {
    this.anims = this.anims.filter((a) => a(now));
    this.controls.update();

    // keep the endless world centred on what we look at
    const t = this.controls.target;
    this.grid.position.set(Math.round(t.x), 0, Math.round(t.z));
    this.follow.position.set(t.x, 0, t.z);
    this.gridMat.uniforms.uCenter.value.set(t.x, t.z);
    this.gridMat.uniforms.uRadius.value = 14 + this.camera.position.distanceTo(t) * 1.3;
    (this.sun.material as THREE.ShaderMaterial).uniforms.uTime.value = now / 1000;
    // the sun always sits on the horizon straight ahead of the camera
    const ahead = new THREE.Vector3(t.x - this.camera.position.x, 0, t.z - this.camera.position.z);
    if (ahead.lengthSq() < 1e-4) ahead.set(0, 0, -1);
    ahead.normalize().multiplyScalar(260);
    this.sun.position.set(ahead.x, 12, ahead.z);
    this.sun.lookAt(this.camera.position.x - t.x, 12, this.camera.position.z - t.z);

    // hover ghost + highlight
    const h = this.hover;
    const canPlace = !!h && !!this.interactive && !this.game.isOver && !this.game.board.has(h.x, h.y);
    for (const p of ['X', 'O'] as Player[]) this.ghost![p].visible = canPlace && this.interactive === p;
    this.highlight.visible = !!h && !this.game.isOver;
    if (h) {
      this.highlight.position.set(h.x, 0.004, h.y);
      if (canPlace) {
        const g = this.ghost![this.interactive!];
        g.position.set(h.x, PIECE_Y + 0.25 + Math.sin(now / 220) * 0.06, h.y);
        g.rotation.y = now / 900;
      }
    }
    if (this.lastRing.visible) {
      const k = (now / 900) % 1;
      this.lastRing.scale.setScalar(1 + 0.25 * k);
      (this.lastRing.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - k);
    }

    this.renderer.info.reset();
    if (this.bloomOn) this.composer.render();
    else this.renderer.render(this.scene, this.camera);

    this.frames++;
    if (now - this.fpsT0 >= 1000) {
      this.stats.fps = Math.round((this.frames * 1000) / (now - this.fpsT0));
      this.frames = 0;
      this.fpsT0 = now;
    }
    this.stats.calls = this.renderer.info.render.calls;
    this.stats.triangles = this.renderer.info.render.triangles;
  }
}
