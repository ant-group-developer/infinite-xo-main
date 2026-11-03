import { sfx } from '../audio';
import type { GameEvent } from '../core/game';
import { other, type Cell, type Player } from '../core/types';
import type { Backend } from '../net/backend';
import { ChatService } from '../net/chat';
import type { Unsub } from '../net/db';
import { MatchSync, type GameDoc, type ResultDoc } from '../net/match';
import { avatarOf, type ChatMessage, type Side } from '../net/schema';
import { icons, mark } from '../ui/icons';
import { isModalOpen, closeModal, showModal, toast } from '../ui/modal';
import type { MatchHost, ModeController } from './mode';
import { esc, ot } from './strings';
import { tierOf } from '../core/elo';
import { applyRatedResult } from '../net/rating';
import { tierBadge, tierName } from './tierBadge';
import { BotDriver } from './BotDriver';
import { track } from '../net/analytics';

export interface MatchScreenHooks {
  /** Player pressed "Room" / "Back to room". */
  onBackToRoom(): void;
  /** Ranked / bot matches: queue again. */
  onPlayAgain?(): void;
}

const $ = (id: string) => document.getElementById(id)!;

/**
 * Drives the main game screen during an online match: board input goes to
 * the database, HUD shows both players + the move clock, chat drawer.
 */
export class MatchScreen implements ModeController {
  readonly sync: MatchSync;
  private chat: ChatService;
  private offs: Unsub[] = [];
  private ticker: ReturnType<typeof setInterval> | undefined;
  private drawer: HTMLElement;
  private unread = 0;
  private lastHurry = 0;
  private resultShown = -1;
  private enteredAt = 0;
  private botDriver: BotDriver | null = null;

  constructor(
    private host: MatchHost,
    private be: Backend,
    private uid: string,
    readonly roomId: string,
    private roomName: string,
    private myName: () => string,
    private hooks: MatchScreenHooks,
  ) {
    this.sync = new MatchSync(be, roomId, uid, host.game);
    this.chat = new ChatService(be, roomId, uid);
    this.drawer = this.buildDrawer();
  }

  enter() {
    this.enteredAt = this.be.db.serverNow();
    this.host.setMode(this);
    document.body.appendChild(this.drawer);
    this.offs.push(
      this.sync.on((e) => {
        if (e.type === 'start') {
          this.resultShown = -1;
          setTimeout(() => this.host.recenter(), 50);
        } else if (e.type === 'result') this.onResult(e.result, e.doc);
        else if (e.type === 'draw-offer') this.onDrawOffer(e.from);
        else if (e.type === 'draw-declined' && this.sync.mySide) toast(ot('m.drawDeclined'));
        this.host.render();
      }),
      this.chat.subscribe((_, m) => this.addChat(m)),
    );
    this.offs.push(
      this.sync.on((e) => {
        // The human host plays the persona's moves in matchmaking bot games.
        if (e.type === 'start' && e.doc.type === 'bot' && !this.botDriver) this.botDriver = new BotDriver(this.sync);
      }),
    );
    this.sync.start();
    this.ticker = setInterval(() => this.tick(), 250);
    this.host.render();
  }

  exit() {
    clearInterval(this.ticker);
    for (const off of this.offs) off();
    this.offs = [];
    this.botDriver?.dispose();
    this.botDriver = null;
    this.sync.dispose();
    this.drawer.remove();
    if (isModalOpen()) closeModal();
    for (const id of ['bResign', 'bDraw', 'bNew']) $(id).style.display = '';
    $('sDraw').classList.remove('hurry');
    this.host.setMode(null);
  }

  /* ------------------------------------------------------- ModeController */

  interactivePlayer(): Player | null {
    const side = this.sync.mySide;
    const d = this.sync.doc;
    return side && d && !d.result && d.turn === side ? side : null;
  }

  onTap(c: Cell) {
    void this.sync.move(c.x, c.y).then((err) => {
      if (!err) return;
      if (err === 'occupied') {
        this.host.reject(c);
        sfx.nope();
      } else if (err === 'not-your-turn') toast(ot('m.notYourTurn'));
      else if (err === 'not-player') toast(ot('m.spectator'));
    });
  }

  onAction(a: 'undo' | 'hint' | 'resign' | 'draw' | 'new') {
    const d = this.sync.doc;
    const ranked = !!d && d.type !== 'casual';
    if (a === 'new' && ranked) return this.hooks.onPlayAgain?.();
    if (a === 'undo' && ranked && d && !d.result && this.sync.mySide) {
      showModal({
        title: ot('m.leave') + '?',
        body: ot('room.leavePlayingB'),
        bodyCenter: true,
        buttons: [{ label: ot('cancel') }, { label: ot('m.leave'), kind: 'danger', onClick: () => this.hooks.onBackToRoom() }],
      });
      return;
    }
    if (a === 'undo' || a === 'new') return this.hooks.onBackToRoom();
    if (a === 'hint') return this.toggleChat();
    if (a === 'resign') {
      if (!this.sync.mySide || this.sync.isOver) return;
      showModal({
        title: ot('m.resignT'),
        body: ot('m.resignB'),
        bodyCenter: true,
        buttons: [{ label: ot('cancel') }, { label: ot('m.resignT').replace('?', ''), kind: 'danger', onClick: () => void this.sync.resign() }],
      });
      return;
    }
    if (a === 'draw') void this.sync.offerDraw().then((ok) => ok && toast(ot('m.drawOffered')));
  }

  onGameEvent(_e: GameEvent) {
    /* results come from the database (onResult) so every client agrees */
  }

  renderHud() {
    const d = this.sync.doc;
    const g = this.host.game;
    const mine = this.sync.mySide;
    for (const p of ['X', 'O'] as Side[]) {
      const card = $(`pl${p}`);
      const info = d?.players[p];
      card.querySelector('.pm')!.innerHTML = mark(p);
      card.querySelector('.pn')!.textContent = info
        ? `${avatarOf(info.avatar)} ${info.name}${p === mine ? ` (${ot('room.you')})` : ''} ${d?.type !== 'casual' ? tierOf(info.rating).def.icon : ''}`
        : '…';
      card.querySelector('.ps')!.textContent = info ? String(info.rating) : '';
      card.classList.toggle('on', !!d && !d.result && d.turn === p);
    }
    $('drLabel').textContent = '⏱';
    this.renderClock();

    const st = $('status');
    st.classList.remove('thinking');
    if (!d) st.textContent = ot('loading');
    else if (d.result) st.textContent = this.resultTitle(d.result, d);
    else if (mine && d.turn === mine) st.textContent = ot('m.yourTurn');
    else st.textContent = ot('m.theirTurn', { name: d.players[d.turn].name });
    $('sub').textContent = `${this.roomName} · ${g.moves.length ? `#${g.moves.length}` : ''}${mine ? '' : ` · 👁 ${ot('m.watching')}`}`;

    const setBtn = (id: string, icon: string, label: string) => {
      const el = $(id);
      el.innerHTML = `${icon}<span>${esc(label)}</span>`;
      el.title = label;
    };
    const ranked = !!d && d.type !== 'casual';
    setBtn('bUndo', icons.undo, ranked ? (d?.result ? ot('m.lobby') : ot('m.leave')) : ot('m.room'));
    setBtn('bHint', '💬', ot('m.chat') + (this.unread ? ` (${this.unread})` : ''));
    ($('bUndo') as HTMLButtonElement).disabled = false;
    ($('bHint') as HTMLButtonElement).disabled = false;
    const playing = !!mine && !!d && !d.result;
    ($('bResign') as HTMLButtonElement).disabled = !playing;
    ($('bDraw') as HTMLButtonElement).disabled = !playing || !!d?.drawOffer || g.moves.length < 2;
    $('bResign').style.display = mine ? '' : 'none';
    $('bDraw').style.display = mine ? '' : 'none';
    const bNew = $('bNew');
    bNew.style.display = d?.result ? '' : 'none';
    bNew.innerHTML = `${icons.refresh}<span>${ranked ? ot('m.again') : ot('m.rematch')}</span>`;
  }

  /* ------------------------------------------------------------- clock */

  private renderClock() {
    const dl = this.sync.deadline;
    const el = $('sDraw');
    if (dl === null) {
      el.textContent = '—';
      el.classList.remove('hurry');
      return;
    }
    const left = Math.max(0, dl - this.sync.serverNow());
    const s = Math.ceil(left / 1000);
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    el.classList.toggle('hurry', s <= 15);
    const mine = this.sync.mySide;
    if (mine && this.sync.doc?.turn === mine && s <= 15 && s > 0 && s !== this.lastHurry && s % 5 === 0) {
      this.lastHurry = s;
      toast(ot('m.hurry', { s }));
      sfx.nope();
    }
  }

  private tick() {
    this.renderClock();
  }

  /* ------------------------------------------------------------ results */

  private resultTitle(r: ResultDoc, d: GameDoc) {
    const mine = this.sync.mySide;
    if (!r.winner) return ot('m.draw');
    if (mine) return r.winner === mine ? ot('m.win') : ot('m.lose');
    return ot('m.pwin', { name: d.players[r.winner].name });
  }

  private onResult(r: ResultDoc, d: GameDoc) {
    if (this.resultShown === d.seq) return;
    this.resultShown = d.seq;
    const mine = this.sync.mySide;
    const won = mine ? r.winner === mine : true;
    if (!r.winner) sfx.draw();
    else if (won) sfx.win();
    else sfx.lose();

    const loser = r.winner ? d.players[other(r.winner)].name : '';
    const reason =
      r.reason === 'five'
        ? ot('m.r.five', { n: r.line?.len ?? 5 })
        : r.reason === 'timeout'
          ? ot('m.r.timeout', { name: loser })
          : r.reason === 'resign'
            ? ot('m.r.resign', { name: loser })
            : r.reason === 'abandon'
              ? ot('m.r.abandon', { name: loser })
              : ot('m.r.draw');
    const tone = !r.winner ? 'draw' : won ? 'win' : 'lose';
    track('match_end', { type: d.type, reason: r.reason, outcome: mine ? tone : 'spectator', moves: d.n });
    // Ranked / bot games: update ratings (exactly once, whoever gets there first).
    const rated = d.type !== 'casual' ? applyRatedResult(this.be, this.roomId, d, this.uid).catch((e) => {
      console.warn('[match] rating update failed', e);
      return null;
    }) : Promise.resolve(null);
    const wait = new Promise((res) => setTimeout(res, r.reason === 'five' ? 1300 : 250));
    void Promise.all([rated, wait]).then(([change]) => {
      if (this.resultShown !== d.seq || !this.sync.doc || this.sync.doc.seq !== d.seq) return;
      let extra = '';
      if (change) {
        const sign = change.delta > 0 ? '+' : '';
        extra += `<p class="delta ${change.delta >= 0 ? 'up' : 'down'}">${esc(ot('m.delta', { before: change.before, after: change.after, delta: sign + change.delta }))}</p>`;
        extra += `<div class="res-tier">${tierBadge(change.after)}</div>`;
        if (change.promoted) {
          extra += `<p class="promo">🎉 ${esc(ot('m.promoted', { tier: tierName(tierOf(change.after)) }))}</p>`;
          sfx.win();
        }
      }
      showModal({
        title: this.resultTitle(r, d),
        tone,
        bodyCenter: true,
        body: `<div class="big">${r.winner ? mark(r.winner) : mark('X') + mark('O')}</div><p>${esc(reason)}</p>${extra}`,
        buttons: [
          { label: ot('m.view') },
          d.type === 'casual'
            ? { label: ot('m.rematch'), kind: 'primary', onClick: () => this.hooks.onBackToRoom() }
            : { label: '⚔ ' + ot('m.again'), kind: 'primary', onClick: () => this.hooks.onPlayAgain?.() },
        ],
      });
    });
  }

  private onDrawOffer(from: Side) {
    const d = this.sync.doc!;
    const name = d.players[from].name;
    const mine = this.sync.mySide;
    if (!mine) return toast(ot('m.drawSpect', { name }));
    if (from === mine) return;
    showModal({
      title: ot('m.drawAskT', { name }),
      body: ot('m.drawAskB'),
      bodyCenter: true,
      dismissible: false,
      buttons: [
        { label: ot('cancel'), onClick: () => void this.sync.answerDraw(false) },
        { label: 'OK', kind: 'primary', onClick: () => void this.sync.answerDraw(true) },
      ],
    });
  }

  /* -------------------------------------------------------------- chat */

  private buildDrawer() {
    const el = document.createElement('div');
    el.className = 'chat-drawer';
    el.hidden = true;
    el.innerHTML = `<div class="room-chat">
      <div class="cd-head"><h4>${ot('chat.title')}</h4><button class="x-btn" data-close>✕</button></div>
      <div class="chat-log"></div>
      <form class="chat-in" autocomplete="off"><input maxlength="200" placeholder="${ot('chat.ph')}" /><button class="btn primary" type="submit">${ot('chat.send')}</button></form>
    </div>`;
    el.querySelector('[data-close]')!.addEventListener('click', () => this.toggleChat(false));
    const form = el.querySelector('form')!;
    const input = el.querySelector('input')!;
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      if (await this.chat.send(this.myName(), input.value)) input.value = '';
      else toast(ot('chat.slow'));
    };
    return el;
  }

  private toggleChat(open = this.drawer.hidden) {
    this.drawer.hidden = !open;
    if (open) {
      this.unread = 0;
      const log = this.drawer.querySelector('.chat-log')!;
      log.scrollTop = log.scrollHeight;
      this.drawer.querySelector('input')!.focus();
    }
    this.host.render();
  }

  private addChat(m: ChatMessage) {
    const log = this.drawer.querySelector('.chat-log')!;
    const line = document.createElement('div');
    line.className = 'msg' + (m.uid === this.uid ? ' mine' : '');
    line.innerHTML = `<b>${esc(m.name)}</b> ${esc(m.text)}`;
    log.appendChild(line);
    while (log.children.length > 120) log.firstElementChild?.remove();
    log.scrollTop = log.scrollHeight;
    if (this.drawer.hidden && m.uid !== this.uid && m.t >= this.enteredAt) {
      this.unread++;
      this.host.render();
    }
  }
}
