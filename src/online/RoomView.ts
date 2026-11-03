import { sfx } from '../audio';
import type { Backend } from '../net/backend';
import { ChatService } from '../net/chat';
import type { Unsub } from '../net/db';
import { resignIfPlaying, startMatch } from '../net/match';
import { RoomError, RoomSession, type MemberInfo } from '../net/rooms';
import { avatarOf, flagOf, type ChatMessage, type RoomMember, type Side } from '../net/schema';
import { mark } from '../ui/icons';
import { showModal, toast } from '../ui/modal';
import { esc, ot, type OKey } from './strings';

export interface RoomViewHooks {
  /** Back to the lobby (after leaving, being kicked or the room closing). */
  onExit(reason: 'left' | 'kicked' | 'closed'): void;
  /** Called once the session is joined (the hub watches it to open matches). */
  onSessionReady?(session: RoomSession): void;
  /** "Watch" pressed while a match is running. */
  onWatch?(): void;
}

/** Lobby screen of one room: player slots, spectators, ready state, chat. */
export class RoomView {
  readonly session: RoomSession;
  private chat: ChatService;
  private offs: Unsub[] = [];
  private el: HTMLElement;
  /** null until the first render, so we only toast on a real hand-over. */
  private prevHost: boolean | null = null;

  constructor(
    private host: HTMLElement,
    readonly be: Backend,
    private uid: string,
    roomId: string,
    me: MemberInfo,
    private hooks: RoomViewHooks,
  ) {
    this.session = new RoomSession(be, uid, roomId, me);
    this.chat = new ChatService(be, roomId, uid);
    this.el = document.createElement('div');
    this.el.className = 'room';
    this.el.addEventListener('click', (e) => void this.onClick(e));
  }

  /** Throws RoomError (not-found / kicked / full). */
  async open() {
    await this.session.join();
    this.host.innerHTML = '';
    this.host.appendChild(this.el);
    this.el.innerHTML = this.skeleton();
    this.bindChatInput();
    this.offs.push(
      this.session.on((e) => {
        if (e.type === 'change') this.renderState();
        else if (e.type === 'kicked') this.exit('kicked');
        else if (e.type === 'closed') this.exit('closed');
        else if (e.type === 'joined') this.sysLine(ot('room.joined', { name: e.member.name }));
        else if (e.type === 'left') this.sysLine(ot('room.left', { name: e.member.name }));
      }),
      this.chat.subscribe((_, m) => this.addMessage(m)),
    );
    this.renderState();
    this.hooks.onSessionReady?.(this.session);
  }

  private exit(reason: 'left' | 'kicked' | 'closed') {
    this.dispose();
    if (reason === 'kicked') toast(ot('room.kicked'), 2500);
    if (reason === 'closed') toast(ot('room.closed'), 2500);
    this.hooks.onExit(reason);
  }

  async leave() {
    await resignIfPlaying(this.be, this.session.id, this.uid).catch(() => false);
    await this.session.leave();
    this.exit('left');
  }

  private confirmLeave() {
    const r = this.session.room;
    if (r?.meta.status === 'playing' && this.session.mySide) {
      showModal({
        title: ot('room.leavePlayingT'),
        body: ot('room.leavePlayingB'),
        bodyCenter: true,
        buttons: [{ label: ot('cancel') }, { label: ot('room.leave'), kind: 'danger', onClick: () => void this.leave() }],
      });
    } else void this.leave();
  }

  dispose() {
    for (const off of this.offs) off();
    this.offs = [];
  }

  /* ------------------------------------------------------------ render */

  private skeleton() {
    return `
      <div class="room-top">
        <button class="ib" data-act="leave" title="${ot('room.leave')}" aria-label="${ot('room.leave')}">
          <svg class="ic" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="room-title"><b id="rmName"></b><small id="rmSub"></small></div>
        <button class="btn" data-act="copy">🔗 <span class="hide-sm">${ot('room.copy')}</span></button>
      </div>
      <div class="room-main">
        <div class="room-left">
          <div class="slots" id="rmSlots"></div>
          <div class="room-status" id="rmStatus"></div>
          <div class="room-actions" id="rmActions"></div>
          <div class="specs"><h4 id="rmSpecTitle"></h4><div class="spec-list" id="rmSpecs"></div></div>
        </div>
        <div class="room-chat">
          <h4>${ot('chat.title')}</h4>
          <div class="chat-log" id="rmChat" aria-live="polite"></div>
          <form class="chat-in" id="rmChatForm" autocomplete="off">
            <input id="rmChatIn" maxlength="200" placeholder="${ot('chat.ph')}" />
            <button class="btn primary" type="submit">${ot('chat.send')}</button>
          </form>
        </div>
      </div>`;
  }

  private renderState() {
    const s = this.session;
    const r = s.room;
    if (!r) return;
    if (this.prevHost === false && s.isHost) toast(ot('room.nowHost'));
    this.prevHost = s.isHost;

    this.q('#rmName').textContent = r.meta.name;
    this.q('#rmSub').textContent = `${ot('room.code')}: ${r.meta.code} · ${ot(r.meta.visibility === 'public' ? 'room.public' : 'room.private')}`;
    this.q('#rmSlots').innerHTML = `${this.slotCard('X')}<div class="vs">VS</div>${this.slotCard('O')}`;

    const specs = s.spectators;
    this.q('#rmSpecTitle').textContent = `${ot('room.spectators')} (${specs.length})`;
    this.q('#rmSpecs').innerHTML = specs.length
      ? specs.map(([u, m]) => this.specChip(u, m)).join('')
      : `<span class="muted">${ot('room.noSpectators')}</span>`;

    const mySide = s.mySide;
    const bothSeated = !!(r.slots?.X && r.slots?.O);
    const bothReady = !!(r.ready?.X && r.ready?.O);
    const playing = r.meta.status === 'playing';
    this.q('#rmStatus').textContent = playing
      ? '🔴 ' + ot('room.playing')
      : !bothSeated
        ? ot('room.waitPlayers')
        : !bothReady
          ? ot('room.waitReady')
          : ot('room.waitHost');

    const acts: string[] = [];
    if (playing) {
      this.q('#rmActions').innerHTML = `<button class="btn primary" data-act="watch">▶ ${ot('room.watch')}</button>`;
      return;
    }
    if (mySide) {
      const ready = !!r.ready?.[mySide];
      acts.push(`<button class="btn ${ready ? '' : 'primary'}" data-act="ready">${ready ? '✓ ' + ot('room.ready') : ot('room.ready')}</button>`);
      acts.push(`<button class="btn" data-act="spectate">👁 ${ot('room.spectate')}</button>`);
    }
    if (s.isHost && bothSeated) acts.push(`<button class="btn" data-act="swap">⇄ ${ot('room.swap')}</button>`);
    if (s.isHost) acts.push(`<button class="btn primary" data-act="start" ${bothSeated && bothReady ? '' : 'disabled'}>▶ ${ot('room.start')}</button>`);
    this.q('#rmActions').innerHTML = acts.join('');
  }

  private slotCard(side: Side) {
    const s = this.session;
    const r = s.room!;
    const uid = r.slots?.[side];
    const color = side === 'X' ? 'x' : 'o';
    if (!uid) {
      const canSit = r.meta.status !== 'playing';
      return `<div class="slot empty ${color}">${mark(side)}<span class="muted">${ot('room.empty')}</span>
        ${canSit ? `<button class="btn primary sm" data-act="sit" data-side="${side}">${ot('room.sit')}</button>` : ''}</div>`;
    }
    const m = s.members[uid];
    const me = uid === this.uid;
    const ready = !!r.ready?.[side];
    const kick = s.isHost && !me ? `<button class="x-btn" data-act="kick" data-uid="${esc(uid)}" title="${ot('room.kick')}">✕</button>` : '';
    if (!m) {
      return `<div class="slot ${color} gone">${mark(side)}<span class="av">❔</span><span class="muted">${ot('room.offline')}</span>${kick}</div>`;
    }
    return `<div class="slot ${color} ${ready ? 'ready' : ''} ${me ? 'me' : ''}">
      ${kick}
      ${mark(side)}
      <span class="av big">${avatarOf(m.avatar)}</span>
      <b class="nm">${esc(m.name)}${me ? ` <small>(${ot('room.you')})</small>` : ''}</b>
      <small class="muted">${flagOf(m.country)} · ${m.rating}${uid === r.meta.hostUid ? ' · 👑' : ''}</small>
      <span class="rd ${ready ? 'on' : ''}">${ready ? '✓ ' + ot('room.ready') : ot('room.notReady')}</span>
    </div>`;
  }

  private specChip(uid: string, m: RoomMember) {
    const s = this.session;
    const me = uid === this.uid;
    const isHost = uid === s.room!.meta.hostUid;
    const muted = this.chat.isMuted(uid);
    return `<div class="chip-u">
      <span class="av sm">${avatarOf(m.avatar)}</span>
      <span>${esc(m.name)}${me ? ` (${ot('room.you')})` : ''}${isHost ? ' 👑' : ''}</span>
      ${!me ? `<button class="x-btn" data-act="mute" data-uid="${esc(uid)}" title="${ot(muted ? 'room.unmute' : 'room.mute')}">${muted ? '🔇' : '💬'}</button>` : ''}
      ${s.isHost && !me ? `<button class="x-btn" data-act="kick" data-uid="${esc(uid)}" title="${ot('room.kick')}">✕</button>` : ''}
    </div>`;
  }

  private addMessage(m: ChatMessage) {
    const line = document.createElement('div');
    line.className = 'msg' + (m.uid === this.uid ? ' mine' : '');
    const time = new Date(m.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    line.innerHTML = `<span class="t">${time}</span> <b>${esc(m.name)}</b> ${esc(m.text)}`;
    this.appendLog(line);
    if (m.uid !== this.uid) sfx.click();
  }

  private sysLine(text: string) {
    const line = document.createElement('div');
    line.className = 'msg sys';
    line.textContent = text;
    this.appendLog(line);
  }

  private appendLog(line: HTMLElement) {
    const log = this.q('#rmChat');
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.appendChild(line);
    while (log.children.length > 120) log.firstElementChild?.remove();
    if (atBottom) log.scrollTop = log.scrollHeight;
  }

  private bindChatInput() {
    const form = this.q<HTMLFormElement>('#rmChatForm');
    const input = this.q<HTMLInputElement>('#rmChatIn');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const text = input.value;
      if (!text.trim()) return;
      const ok = await this.chat.send(this.session.members[this.uid]?.name ?? '?', text);
      if (ok) input.value = '';
      else toast(ot('chat.slow'));
    };
  }

  /* ------------------------------------------------------------ events */

  private async onClick(e: MouseEvent) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t || (t as HTMLButtonElement).disabled) return;
    sfx.click();
    const s = this.session;
    try {
      switch (t.dataset.act) {
        case 'leave':
          return this.confirmLeave();
        case 'copy':
          return await this.copyLink();
        case 'sit':
          return await s.claimSlot(t.dataset.side as Side);
        case 'spectate':
          return await s.leaveSlot();
        case 'ready':
          return await s.setReady(!s.room?.ready?.[s.mySide!]);
        case 'mute':
          this.chat.toggleMute(t.dataset.uid!);
          return this.renderState();
        case 'kick': {
          const uid = t.dataset.uid!;
          const name = s.members[uid]?.name ?? '?';
          showModal({
            title: ot('room.kickT', { name }),
            body: ot('room.kickB'),
            bodyCenter: true,
            buttons: [
              { label: ot('cancel') },
              { label: ot('room.kick'), kind: 'danger', onClick: () => void s.kick(uid) },
            ],
          });
          return;
        }
        case 'start':
          if (s.room) await startMatch(this.be, s.id, s.room);
          return;
        case 'swap':
          return await s.swapSides();
        case 'watch':
          return this.hooks.onWatch?.();
      }
    } catch (err) {
      if (err instanceof RoomError) toast(ot(roomErrKey(err.code)));
      else {
        console.error(err);
        toast(String(err));
      }
    }
  }

  private async copyLink() {
    const code = this.session.meta?.code;
    if (!code) return;
    const url = `${location.origin}${location.pathname}#/r/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      toast(ot('room.copied'));
    } catch {
      showModal({ title: ot('room.copy'), body: `<p style="user-select:all;word-break:break-all">${esc(url)}</p>`, buttons: [{ label: 'OK', kind: 'primary' }] });
    }
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    return this.el.querySelector(sel) as T;
  }
}

export function roomErrKey(code: string): OKey {
  switch (code) {
    case 'not-found':
      return 'room.notFound';
    case 'kicked':
      return 'room.kicked';
    case 'full':
      return 'room.full';
    case 'slot-taken':
      return 'room.slotTaken';
    default:
      return 'connectFail';
  }
}
