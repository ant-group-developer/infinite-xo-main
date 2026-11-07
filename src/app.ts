import { BotClient } from './ai/BotClient';
import { evaluate, type Level } from './ai/bot';
import { sfx } from './audio';
import { Game, type GameEvent } from './core/game';
import { other, type Cell, type Player } from './core/types';
import type { ModeController } from './online/mode';
import { getLang, setLang, t, type Lang, type TKey } from './i18n';
import { load, save } from './storage';
import { icons, mark } from './ui/icons';
import { isModalOpen, justClosed, showModal, toast } from './ui/modal';
import type { BoardView } from './view/BoardView';
import { CanvasView } from './view2d/CanvasView';
import { OnlineHub } from './online/OnlineHub';
import { ProfilePage } from './online/ProfilePage';
import { onlineEnabled } from './runtimeConfig';
import type { CameraPreset, Theme3D, ThreeView } from './view3d/ThreeView';

type Opp = 'bot' | 'two';
/** What the start menu offers: the two offline modes + the online hub. */
type MenuMode = Opp | 'online';
/** Side picked in the menu; 'random' is re-rolled for every new game. */
type SidePick = Player | 'random';
const LEVELS: Level[] = ['easy', 'medium', 'hard'];

interface Settings {
  /** opponent of the offline game on the board */
  opp: Opp;
  /** last mode picked in the start menu */
  mode: MenuMode;
  level: Level;
  side: SidePick;
  sound: boolean;
  lang: Lang;
  /** the one-time "tap a cell" hint has been used up */
  tapHint: boolean;
  /** board renderer: classic 2D canvas or Three.js */
  view: '2d' | '3d';
  theme3d: Theme3D['id'];
  cam3d: CameraPreset;
  glow3d: boolean;
}

interface Record3 {
  w: number;
  l: number;
  d: number;
}
interface Stats {
  easy: Record3;
  medium: Record3;
  hard: Record3;
  streak: number;
  best: number;
}

const freshStats = (): Stats => ({
  easy: { w: 0, l: 0, d: 0 },
  medium: { w: 0, l: 0, d: 0 },
  hard: { w: 0, l: 0, d: 0 },
  streak: 0,
  best: 0,
});

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BOT_MIN_DELAY = 420;

export class App {
  readonly game = new Game();
  private view: BoardView;
  private bot = new BotClient();
  private hintBot = new BotClient();
  readonly hub: OnlineHub;
  readonly profilePage: ProfilePage;
  /** When set (online match), input / HUD / game-end handling are delegated to it. */
  private mode: ModeController | null = null;

  private settings: Settings = load<Settings>('settings', {
    opp: 'bot',
    mode: 'bot',
    level: 'medium',
    // older versions stored the side as `human`
    side: load<{ human?: Player }>('settings', {}).human ?? 'X',
    sound: true,
    // Vietnamese by default, whatever the browser language (?lang= / the portal can switch it).
    lang: 'vi',
    tapHint: false,
    view: '2d',
    theme3d: 'neon',
    cam3d: 'tilt',
    glow3d: false,
  });
  private viewMode: '2d' | '3d' = '2d';
  private switchingView = false;
  private stats: Stats = load<Stats>('stats', freshStats());
  private session = { bot: { you: 0, bot: 0, d: 0 }, two: { X: 0, O: 0, d: 0 } };

  private thinking = false;
  private hintBusy = false;
  /** bumps on every new game / undo so stale async work is ignored */
  private epoch = 0;
  private resultTimer = 0;
  /** level & side at the start of the current game (stats are attributed to these) */
  private gameLevel: Level = this.settings.level;
  private gameHuman: Player = this.settings.side === 'O' ? 'O' : 'X';

  constructor() {
    // Portal nhúng game (ANT Play) truyền ?lang=vi|en: ưu tiên hơn ngôn ngữ đã lưu.
    const langFromQuery = new URLSearchParams(location.search).get('lang');
    if (langFromQuery === 'vi' || langFromQuery === 'en') this.settings.lang = langFromQuery;
    setLang(this.settings.lang);
    sfx.setEnabled(this.settings.sound);

    this.hub = new OnlineHub(this);
    this.profilePage = new ProfilePage(this.hub, () => this.stats);
    this.hub.onOpenProfile = () => void this.profilePage.open();
    this.view = new CanvasView($('stage'), this.game);
    this.view.onCellTap = (c) => this.onTap(c);
    if (this.settings.view === '3d') void this.setViewMode('3d', false);
    this.game.on((e) => this.onGameEvent(e));

    const unlock = () => sfx.unlock();
    document.addEventListener('pointerdown', unlock, { capture: true });
    document.addEventListener('keydown', unlock, { capture: true });

    if (this.settings.mode === 'online' && !onlineEnabled()) this.settings.mode = 'bot';

    this.bindStatic();
    this.bindMenu();
    this.applyTexts();
    // Open on the start menu; the game starts when the player presses Play.
    this.showMenu();
  }

  /* ------------------------------------------------------- 2D / 3D view */

  /** Swap the board renderer. 3D (three.js) is downloaded only when first used. */
  async setViewMode(mode: '2d' | '3d', save = true) {
    if (mode === this.viewMode || this.switchingView) return;
    this.switchingView = true;
    try {
      let next: BoardView;
      if (mode === '3d') {
        const loading = setTimeout(() => toast(t('toast.loading3d')), 250);
        const mod = await import('./view3d/ThreeView');
        clearTimeout(loading);
        if (!mod.webglAvailable()) {
          toast(t('toast.no3d'), 2500);
          if (save) {
            this.settings.view = '2d';
            this.saveSettings();
          }
          return;
        }
        this.view.destroy();
        next = new mod.ThreeView($('stage'), this.game, {
          theme: this.settings.theme3d,
          camera: this.settings.cam3d,
          glow: this.settings.glow3d,
        });
      } else {
        this.view.destroy();
        next = new CanvasView($('stage'), this.game);
        next.recenter(false);
      }
      next.onCellTap = (c) => this.onTap(c);
      this.view = next;
      this.viewMode = mode;
      document.body.classList.toggle('view-3d', mode === '3d');
      if (save) {
        this.settings.view = mode;
        this.saveSettings();
      }
      this.applyTexts();
    } catch (e) {
      console.error('[3d] failed to start', e);
      toast(t('toast.no3d'), 2500);
    } finally {
      this.switchingView = false;
    }
  }

  private show3dSettings() {
    const v = this.view as unknown as ThreeView;
    if (this.viewMode !== '3d') return;
    const seg = (name: string, cur: string, opts: [string, TKey][]) =>
      `<div class="seg view-seg" data-group="${name}">${opts
        .map(([id, key]) => `<button data-v="${id}" class="${id === cur ? 'on' : ''}">${t(key)}</button>`)
        .join('')}</div>`;
    const m = showModal({
      title: t('view.settings'),
      body: `<div class="view-settings">
        <h4>${t('view.camera')}</h4>${seg('cam', this.settings.cam3d, [['tilt', 'cam.tilt'], ['top', 'cam.top'], ['cinema', 'cam.cinema']])}
        <h4>${t('view.theme')}</h4>${seg('theme', this.settings.theme3d, [['neon', 'theme.neon'], ['sunset', 'theme.sunset'], ['ice', 'theme.ice']])}
        <h4>${t('view.glow')}</h4>${seg('glow', this.settings.glow3d ? 'on' : 'off', [['off', 'glow.off'], ['on', 'glow.on']])}
        <p class="muted small">${t('view.glowNote')}</p>
        <p class="muted small">${t('view.controls')}</p>
      </div>`,
      buttons: [{ label: 'OK', kind: 'primary' }],
    });
    m.querySelectorAll<HTMLElement>('.view-seg').forEach((g) =>
      g.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-v]');
        if (!b) return;
        sfx.click();
        g.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        const val = b.dataset.v!;
        if (g.dataset.group === 'cam') {
          this.settings.cam3d = val as CameraPreset;
          v.setCameraPreset(this.settings.cam3d);
        } else if (g.dataset.group === 'theme') {
          this.settings.theme3d = val as Theme3D['id'];
          v.setTheme(this.settings.theme3d);
        } else {
          this.settings.glow3d = val === 'on';
          v.setBloom(this.settings.glow3d);
        }
        this.saveSettings();
      }),
    );
  }

  /* ------------------------------------------------- online mode hooks */

  /** Hand input/HUD to an online controller (null = back to the offline game). */
  setMode(mode: ModeController | null) {
    this.mode = mode;
    if (mode) {
      clearTimeout(this.resultTimer);
      this.epoch++;
      this.bot.cancel();
      this.hintBot.cancel();
      this.thinking = false;
      this.hintBusy = false;
      document.body.classList.add('online-match');
      this.hideMenu();
    } else {
      document.body.classList.remove('online-match');
      this.applyTexts();
      // Back from an online match: the hub is shown again on top; closing it
      // lands on the start menu (the online flow always starts there).
      this.resetBoard();
      this.showMenu();
    }
    this.render();
  }

  recenter() {
    this.view.recenter(true);
  }

  playOfflineBot() {
    this.settings.opp = 'bot';
    this.settings.mode = 'bot';
    this.saveSettings();
    this.hideMenu();
    this.startGame();
  }

  showHint(cell: Cell | null) {
    this.view.showHint(cell);
  }

  reject(cell: Cell) {
    this.view.reject(cell);
  }

  /* ---------------------------------------------------------- helpers */

  private get isBot() {
    return this.settings.opp === 'bot';
  }
  private get botSide(): Player {
    return other(this.gameHuman);
  }
  private nameOf(p: Player): string {
    if (this.isBot) return p === this.gameHuman ? t('you') : t('bot');
    return p === 'X' ? t('p1') : t('p2');
  }
  private saveSettings() {
    save('settings', this.settings);
  }
  private humanCanAct(): boolean {
    const g = this.game;
    if (g.isOver || this.thinking) return false;
    return !this.isBot || g.turn === this.gameHuman;
  }

  /* -------------------------------------------------------- game flow */

  /** Stop any pending bot / hint work and clear the board (no game started). */
  private resetBoard() {
    clearTimeout(this.resultTimer);
    this.epoch++;
    this.bot.cancel();
    this.hintBot.cancel();
    this.thinking = false;
    this.hintBusy = false;
    this.game.reset('X');
  }

  private startGame() {
    this.resetBoard();
    this.gameLevel = this.settings.level;
    const s = this.settings.side;
    this.gameHuman = s === 'random' ? (Math.random() < 0.5 ? 'X' : 'O') : s;
    this.render();
    void this.maybeBotMove();
  }

  /** Ask for confirmation when a game is in progress, then apply + restart. */
  private restartWith(apply: () => void) {
    const g = this.game;
    const go = () => {
      apply();
      this.saveSettings();
      this.startGame();
    };
    if (g.moves.length > 0 && !g.isOver) {
      showModal({
        title: t('confirm.newT'),
        body: t('confirm.newB'),
        bodyCenter: true,
        buttons: [{ label: t('cancel') }, { label: t('yes'), kind: 'primary', onClick: go }],
      });
    } else go();
  }

  private onTap(c: Cell) {
    if (isModalOpen() || justClosed() || this.menuOpen) return;
    if (this.mode) return this.mode.onTap(c);
    const g = this.game;
    if (g.isOver) return;
    if (this.isBot && (this.thinking || g.turn !== this.gameHuman)) {
      toast(t('toast.wait'));
      return;
    }
    const res = g.play(c.x, c.y);
    if (!res.ok) {
      if (res.reason === 'occupied') {
        this.view.reject(c);
        sfx.nope();
        toast(t('toast.occupied'));
      }
      return;
    }
    if (!this.settings.tapHint) {
      this.settings.tapHint = true; // the "tap a cell" hint is shown only until the first move ever
      this.saveSettings();
    }
    void this.maybeBotMove();
  }

  private async maybeBotMove() {
    if (this.mode) return;
    const g = this.game;
    if (!this.isBot || g.isOver || g.turn === this.gameHuman) return;
    const epoch = this.epoch;
    this.thinking = true;
    this.render();
    const t0 = performance.now();
    const level = this.gameLevel;
    const reply = await this.bot.ask({
      moves: g.moves.map((m) => ({ ...m })),
      player: this.botSide,
      level,
      timeMs: level === 'hard' ? 700 : 200,
      seed: (Math.random() * 2 ** 31) | 0,
    });
    if (!reply || epoch !== this.epoch) return;
    const wait = BOT_MIN_DELAY - (performance.now() - t0);
    if (wait > 0) await sleep(wait);
    if (epoch !== this.epoch) return;
    this.thinking = false;
    const res = g.play(reply.move.x, reply.move.y, this.botSide);
    if (!res.ok) console.error('bot produced an illegal move', reply, res);
    this.render();
  }

  private onGameEvent(e: GameEvent) {
    if (this.mode) {
      if (e.type === 'move') sfx.place(e.move.p);
      this.mode.onGameEvent(e);
      this.render();
      return;
    }
    switch (e.type) {
      case 'move':
        sfx.place(e.move.p);
        this.render();
        break;
      case 'undo':
      case 'reset':
        this.render();
        break;
      case 'win': {
        const humanWon = !this.isBot || e.winner === this.gameHuman;
        if (humanWon) sfx.win();
        else {
          sfx.lose();
          $('stage').classList.remove('shake');
          void $('stage').offsetWidth;
          $('stage').classList.add('shake');
        }
        this.record(e.winner);
        this.render();
        this.resultTimer = window.setTimeout(() => this.showResult(), 1300);
        break;
      }
      case 'resign':
        if (this.isBot && e.loser === this.gameHuman) sfx.lose();
        else sfx.win();
        this.record(e.winner);
        this.render();
        this.resultTimer = window.setTimeout(() => this.showResult(), 250);
        break;
      case 'draw':
        sfx.draw();
        this.record(null);
        this.render();
        this.resultTimer = window.setTimeout(() => this.showResult(), 250);
        break;
      case 'draw-declined':
        toast(this.isBot ? t('draw.botDeclined') : t('draw.declined', { name: this.nameOf(e.by) }), 2000);
        this.render();
        break;
      case 'draw-offer':
        this.render();
        break;
    }
  }

  private record(winner: Player | null) {
    if (this.isBot) {
      const s = this.session.bot;
      const r = this.stats[this.gameLevel];
      if (winner === null) {
        s.d++;
        r.d++;
      } else if (winner === this.gameHuman) {
        s.you++;
        r.w++;
        this.stats.streak++;
        this.stats.best = Math.max(this.stats.best, this.stats.streak);
      } else {
        s.bot++;
        r.l++;
        this.stats.streak = 0;
      }
      save('stats', this.stats);
    } else {
      const s = this.session.two;
      if (winner === null) s.d++;
      else s[winner]++;
    }
  }

  private showResult() {
    const g = this.game;
    let title: string,
      tone: 'win' | 'lose' | 'draw',
      body = '';
    if (g.status === 'draw') {
      title = t('res.draw');
      tone = 'draw';
      body = `<div class="big">${mark('X')}${mark('O')}</div><p>${t('res.agreed')}</p>`;
    } else {
      const w = g.winner!;
      const humanWon = !this.isBot || w === this.gameHuman;
      tone = humanWon ? 'win' : 'lose';
      title = this.isBot ? (humanWon ? t('res.win') : t('res.lose')) : t('res.pwin', { name: this.nameOf(w) });
      body = `<div class="big">${mark(w)}</div>`;
      if (g.status === 'resigned') {
        const loser = other(w);
        body += `<p>${this.isBot ? (loser === this.gameHuman ? t('res.resignYou') : t('res.resignBot')) : t('res.resignP', { name: this.nameOf(loser) })}</p>`;
      } else if (g.winLine) {
        body += `<p>${t('res.line', { n: g.winLine.length })}</p>`;
      }
      if (this.isBot && humanWon && this.stats.streak > 1) body += `<p>🔥 ${t('stats.streak')}: <b>${this.stats.streak}</b></p>`;
    }
    showModal({
      title,
      tone,
      body,
      bodyCenter: true,
      buttons: [{ label: t('close') }, { label: t('next'), kind: 'primary', onClick: () => this.startGame() }],
    });
  }

  /* ---------------------------------------------------------- actions */

  private undo() {
    const g = this.game;
    if (g.isOver || !g.moves.length) return;
    this.epoch++;
    this.hintBot.cancel();
    this.hintBusy = false;
    if (!this.isBot) {
      g.undo(1);
    } else if (this.thinking) {
      // Human just moved and the bot is thinking: take back the human move.
      this.bot.cancel();
      this.thinking = false;
      g.undo(1);
    } else {
      // Human to move; last move was the bot's. Remove bot + human moves.
      const humanMoves = g.moves.filter((m) => m.p === this.gameHuman).length;
      if (!humanMoves) {
        toast(t('toast.noUndo'));
        return;
      }
      g.undo(2);
    }
    sfx.click();
    this.render();
    void this.maybeBotMove();
  }

  private async hint() {
    if (!this.humanCanAct() || this.hintBusy) return;
    const g = this.game;
    const epoch = this.epoch;
    this.hintBusy = true;
    this.render();
    const reply = await this.hintBot.ask({
      moves: g.moves.map((m) => ({ ...m })),
      player: g.turn,
      level: 'hard',
      timeMs: 350,
      seed: 7,
    });
    this.hintBusy = false;
    if (!reply || epoch !== this.epoch || g.isOver) return this.render();
    this.view.showHint(reply.move);
    sfx.hint();
    this.render();
  }

  private offerDraw() {
    const g = this.game;
    if (g.isOver || !g.moves.length || this.thinking) return;
    if (this.isBot) {
      if (!g.offerDraw(this.gameHuman)) return;
      toast(t('draw.thinking'), 900);
      const epoch = this.epoch;
      setTimeout(() => {
        if (epoch !== this.epoch || g.isOver || g.drawOfferFrom !== this.gameHuman) return;
        const score = evaluate(g.moves, this.botSide);
        // The bot accepts only once the game is mature and it is not ahead.
        const accept = g.moves.length >= 16 && score <= 500;
        g.respondDraw(this.botSide, accept);
      }, 900);
      return;
    }
    const from = g.turn;
    const to = other(from);
    if (!g.offerDraw(from)) return;
    showModal({
      title: t('draw.askT', { name: this.nameOf(from) }),
      body: `<div class="big">${mark(to)}</div><p>${t('draw.askB', { name: this.nameOf(to) })}</p>`,
      bodyCenter: true,
      dismissible: false,
      buttons: [
        { label: t('draw.decline'), onClick: () => g.respondDraw(to, false) },
        { label: t('draw.accept'), kind: 'primary', onClick: () => g.respondDraw(to, true) },
      ],
    });
  }

  private resign() {
    const g = this.game;
    if (g.isOver) return;
    const who = this.isBot ? this.gameHuman : g.turn;
    showModal({
      title: t('confirm.resignT'),
      body: this.isBot ? t('confirm.resignB') : t('confirm.resignP', { name: this.nameOf(who) }),
      bodyCenter: true,
      buttons: [
        { label: t('cancel') },
        {
          label: t('resign'),
          kind: 'danger',
          onClick: () => {
            this.epoch++;
            this.bot.cancel();
            this.thinking = false;
            g.resign(who);
          },
        },
      ],
    });
  }

  private showHelp() {
    const m = showModal({ title: t('help.title'), body: t('help.body'), buttons: [{ label: 'OK', kind: 'primary' }] });
    m.dataset.panel = 'help';
  }

  private showStats() {
    const s = this.stats;
    const tot = LEVELS.reduce((a, l) => ({ w: a.w + s[l].w, l: a.l + s[l].l, d: a.d + s[l].d }), { w: 0, l: 0, d: 0 });
    const rows = LEVELS.map(
      (l) => `<tr><td>${t(`level.${l}` as TKey)}</td><td>${s[l].w}</td><td>${s[l].l}</td><td>${s[l].d}</td></tr>`,
    ).join('');
    const m = showModal({
      title: t('stats'),
      body: `<p style="text-align:center">${t('stats.sub')}</p>
      <div class="stat-grid">
        <div><b>${tot.w}</b><span>${t('stats.won')}</span></div>
        <div><b>${s.streak}</b><span>${t('stats.streak')}</span></div>
        <div><b>${s.best}</b><span>${t('stats.best')}</span></div>
      </div>
      <table class="stat-table"><tr><th></th><th>${t('stats.won')}</th><th>${t('stats.lost')}</th><th>${t('stats.drawn')}</th></tr>${rows}</table>
      <div style="text-align:center"><button class="link-btn" id="bResetStats">${t('stats.reset')}</button></div>`,
      buttons: [{ label: t('close'), kind: 'primary' }],
    });
    m.dataset.panel = 'stats';
    m.querySelector<HTMLButtonElement>('#bResetStats')!.onclick = () => {
      this.stats = freshStats();
      save('stats', this.stats);
      this.showStats();
    };
  }

  /* ---------------------------------------------------------------- UI */

  private onClick(id: string, fn: () => void) {
    $(id).addEventListener('click', () => {
      sfx.click();
      fn();
    });
  }

  private bindStatic() {
    const on = (id: string, fn: () => void) => this.onClick(id, fn);
    const act = (a: 'undo' | 'hint' | 'resign' | 'draw' | 'new', local: () => void) => () =>
      this.mode ? this.mode.onAction(a) : local();
    on('bUndo', act('undo', () => this.undo()));
    on('bHint', act('hint', () => void this.hint()));
    on('bResign', act('resign', () => this.resign()));
    on('bDraw', act('draw', () => this.offerDraw()));
    on('bNew', act('new', () => this.restartWith(() => {})));
    on('bMenu', () => this.showMenu(true));
    on('bHelp', () => this.showHelp());
    on('bProfile', () => void this.profilePage.open());
    on('bView', () => void this.setViewMode(this.viewMode === '3d' ? '2d' : '3d'));
    on('b3dSettings', () => this.show3dSettings());
    on('bCenter', () => this.view.recenter(true));
    on('bZoomIn', () => this.view.zoomBy(1.3));
    on('bZoomOut', () => this.view.zoomBy(1 / 1.3));
    on('bSound', () => this.toggleSound());
  }

  private toggleSound() {
    this.settings.sound = !this.settings.sound;
    sfx.setEnabled(this.settings.sound);
    this.saveSettings();
    this.applyTexts();
  }

  /** Đổi ngôn ngữ và vẽ lại chữ (nút EN/VI ở menu, hoặc portal gửi postMessage). */
  changeLang(lang: Lang) {
    if (lang === getLang()) return;
    // Hộp "Cách chơi" / "Thống kê" đang mở thì mở lại bằng ngôn ngữ mới.
    const openPanel = isModalOpen() ? document.querySelector<HTMLElement>('#overlay .modal')?.dataset.panel : undefined;
    this.settings.lang = lang;
    setLang(lang);
    this.saveSettings();
    this.applyTexts();
    this.hub.refresh();
    this.profilePage.refresh();
    if (openPanel === 'help') this.showHelp();
    else if (openPanel === 'stats') this.showStats();
  }

  /* -------------------------------------------------------- start menu */

  private menuOpen = false;

  private bindMenu() {
    const on = (id: string, fn: () => void) => this.onClick(id, fn);
    on('mPlay', () => this.playFromMenu());
    on('mResume', () => this.hideMenu());
    on('mHelp', () => this.showHelp());
    on('mStats', () => this.showStats());
    on('mSound', () => this.toggleSound());
    on('mLang', () => this.changeLang(getLang() === 'vi' ? 'en' : 'vi'));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.menuOpen || isModalOpen() || this.hub.isOpen || this.profilePage.isOpen) return;
      if (this.canResume()) this.hideMenu();
    });
  }

  /** An offline game is under way (the menu can offer "Continue"). */
  private canResume() {
    return !this.mode && this.game.moves.length > 0 && !this.game.isOver;
  }

  /** Full-screen start menu over the game. `focus`: move keyboard focus to Play (user-opened). */
  showMenu(focus = false) {
    this.menuOpen = true;
    $('menu').hidden = false;
    document.body.classList.add('menu-open');
    // The game behind the menu must not be reachable with Tab / screen readers.
    document.querySelectorAll('.game-ui').forEach((el) => el.setAttribute('inert', ''));
    this.renderMenu();
    if (focus) $('mPlay').focus({ preventScroll: true });
  }

  hideMenu() {
    if (!this.menuOpen) return;
    this.menuOpen = false;
    $('menu').hidden = true;
    document.body.classList.remove('menu-open');
    document.querySelectorAll('.game-ui').forEach((el) => el.removeAttribute('inert'));
  }

  private playFromMenu() {
    const mode = this.settings.mode;
    // Online: the hub (quick match / rooms) opens on top of the menu; a match hides the menu.
    if (mode === 'online') return void this.hub.open();
    this.settings.opp = mode;
    this.saveSettings();
    this.hideMenu();
    this.startGame();
    this.view.recenter(false);
  }

  /** Accessible single-choice group: role=radio buttons, arrow keys move the choice. */
  private radios<T extends string>(
    box: HTMLElement,
    opts: { id: T; html: string; label: string }[],
    cur: T,
    pick: (id: T) => void,
  ) {
    box.innerHTML = '';
    const btns = opts.map((o) => {
      const b = document.createElement('button');
      const on = o.id === cur;
      b.type = 'button';
      b.dataset.v = o.id;
      b.innerHTML = o.html;
      b.className = on ? 'on' : '';
      b.title = o.label;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', o.label);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      b.onclick = () => {
        sfx.click();
        if (o.id !== cur) choose(o.id);
      };
      box.appendChild(b);
      return b;
    });
    if (!opts.some((o) => o.id === cur) && btns[0]) btns[0].tabIndex = 0;
    const choose = (id: T) => {
      pick(id);
      box.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
    };
    box.onkeydown = (e) => {
      const i = btns.indexOf(document.activeElement as HTMLButtonElement);
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (i < 0 || !d) return;
      e.preventDefault();
      sfx.click();
      choose(btns[(i + d + btns.length) % btns.length].dataset.v as T);
    };
  }

  private renderMenu() {
    const s = this.settings;
    const setBtn = (id: string, html: string, label: string) => {
      const el = $(id);
      el.innerHTML = html;
      el.setAttribute('aria-label', label);
      el.title = label;
    };
    $('mnName').textContent = t('title');
    $('mnMarks').innerHTML = mark('X') + mark('O');
    setBtn('mStats', icons.trophy, t('stats'));
    setBtn('mSound', s.sound ? icons.soundOn : icons.soundOff, t('sound'));
    setBtn('mHelp', icons.help, t('help'));
    setBtn('mLang', getLang().toUpperCase(), t('lang'));

    const save = () => {
      this.saveSettings();
      this.renderMenu();
    };
    $('mnModeL').textContent = t('menu.mode');
    const modes: [MenuMode, string, TKey][] = [
      ['bot', icons.bot, 'opp.bot'],
      ['two', icons.users, 'opp.two'],
    ];
    if (onlineEnabled()) modes.push(['online', icons.globe, 'opp.online']);
    this.radios(
      $('mnMode'),
      modes.map(([id, icon, key]) => ({ id, html: `${icon}<span>${t(key)}</span>`, label: t(key) })),
      s.mode,
      (id) => ((s.mode = id), save()),
    );

    // Difficulty / side only matter against the bot (online sides come from the room / matchmaking).
    const vsBot = s.mode === 'bot';
    $('mnLevelG').hidden = !vsBot;
    $('mnSideG').hidden = !vsBot;
    $('mnLevelL').textContent = t('menu.level');
    this.radios(
      $('mnLevel'),
      LEVELS.map((l) => ({ id: l, html: `<span>${t(`level.${l}` as TKey)}</span>`, label: t(`level.${l}` as TKey) })),
      s.level,
      (id) => ((s.level = id), save()),
    );
    $('mnSideL').textContent = t('menu.side');
    this.radios<SidePick>(
      $('mnSide'),
      [
        { id: 'X', html: mark('X'), label: 'X' },
        { id: 'O', html: mark('O'), label: 'O' },
        { id: 'random', html: icons.dice, label: t('side.random') },
      ],
      s.side,
      (id) => ((s.side = id), save()),
    );

    setBtn('mPlay', `${icons.play}<span>${t('menu.play')}</span>`, t('menu.play'));
    const resume = $('mResume');
    resume.hidden = !this.canResume();
    resume.textContent = t('menu.resume');
  }

  /* ---------------------------------------------------------------- HUD */

  /** Static labels / icons (re-run on language or sound change). */
  private applyTexts() {
    const setBtn = (id: string, icon: string, label: string, showLabel = true) => {
      const el = $(id);
      el.innerHTML = icon + (showLabel ? `<span>${label}</span>` : '');
      el.setAttribute('aria-label', label);
      el.title = label;
    };
    $('logoT').textContent = t('title');
    document.title = getLang() === 'vi' ? 'XO Vô Hạn — Infinite XO' : 'Infinite XO';
    setBtn('bMenu', icons.home, t('menu'), false);
    setBtn('bProfile', icons.user, getLang() === 'vi' ? 'Hồ sơ' : 'Profile', false);
    $('bView').textContent = this.viewMode === '3d' ? '2D' : '3D';
    $('bView').title = t(this.viewMode === '3d' ? 'view.to2d' : 'view.to3d');
    $('bView').setAttribute('aria-label', $('bView').title);
    setBtn('b3dSettings', icons.cube, t('view.settings'), false);
    $('bProfile').style.display = onlineEnabled() ? '' : 'none';
    setBtn('bSound', this.settings.sound ? icons.soundOn : icons.soundOff, t('sound'), false);
    setBtn('bHelp', icons.help, t('help'), false);
    setBtn('bUndo', icons.undo, t('undo'));
    setBtn('bHint', icons.hint, t('hint'));
    setBtn('bResign', icons.flag, t('resign'));
    setBtn('bDraw', icons.handshake, t('offerDraw'));
    setBtn('bNew', icons.refresh, t('newGame'));
    setBtn('bCenter', icons.target, t('recenter'), false);
    setBtn('bZoomIn', icons.plus, t('zoomIn'), false);
    setBtn('bZoomOut', icons.minus, t('zoomOut'), false);
    $('drLabel').textContent = t('draws');
    this.renderMenu();
    this.render();
  }

  render() {
    const g = this.game;
    if (this.mode) {
      this.mode.renderHud();
      this.view.setInteractive(this.mode.interactivePlayer());
      return;
    }
    // score cards (the bot card also shows the difficulty, now that it is picked in the menu)
    for (const p of ['X', 'O'] as Player[]) {
      const card = $(`pl${p}`);
      card.querySelector('.pm')!.innerHTML = mark(p);
      card.querySelector('.pn')!.textContent =
        this.isBot && p === this.botSide ? `${t('bot')} · ${t(`level.${this.gameLevel}` as TKey)}` : this.nameOf(p);
      const score = this.isBot
        ? p === this.gameHuman
          ? this.session.bot.you
          : this.session.bot.bot
        : this.session.two[p];
      card.querySelector('.ps')!.textContent = String(score);
      card.classList.toggle('on', !g.isOver && g.turn === p);
    }
    $('sDraw').textContent = String(this.isBot ? this.session.bot.d : this.session.two.d);

    // status
    const st = $('status');
    st.classList.toggle('thinking', this.thinking);
    if (g.status === 'won' || g.status === 'resigned') {
      st.textContent =
        this.isBot ? (g.winner === this.gameHuman ? t('res.win') : t('res.lose')) : t('res.pwin', { name: this.nameOf(g.winner!) });
    } else if (g.status === 'draw') st.textContent = t('res.draw');
    else if (this.isBot) st.textContent = this.thinking || g.turn !== this.gameHuman ? t('turn.bot') : t('turn.you');
    else st.textContent = t('turn.player', { name: this.nameOf(g.turn) });
    // One short hint for brand-new players only; otherwise no helper text under the status.
    $('sub').textContent = !g.moves.length && !this.settings.tapHint ? t('sub.start') : '';

    // buttons
    const playing = !g.isOver;
    const humanMoves = this.isBot ? g.moves.some((m) => m.p === this.gameHuman) : g.moves.length > 0;
    ($('bUndo') as HTMLButtonElement).disabled = !playing || !humanMoves;
    ($('bHint') as HTMLButtonElement).disabled = !this.humanCanAct() || this.hintBusy;
    ($('bResign') as HTMLButtonElement).disabled = !playing;
    ($('bDraw') as HTMLButtonElement).disabled = !playing || g.moves.length < 2 || this.thinking || !!g.drawOfferFrom;

    this.view.setInteractive(this.humanCanAct() ? g.turn : null);
  }
}
