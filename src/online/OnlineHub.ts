import { sfx } from '../audio';
import { getLang } from '../i18n';
import { getBackend, type Backend } from '../net/backend';
import type { Unsub } from '../net/db';
import { startPresence } from '../net/presence';
import { ProfileError, ProfileService } from '../net/profile';
import { RoomError, createRoom, findRoomByCode, listPublicRooms, type MemberInfo } from '../net/rooms';
import { AVATARS, COUNTRIES, avatarOf, flagOf, type RoomIndexEntry } from '../net/schema';
import { showModal, toast } from '../ui/modal';
import { RoomView, roomErrKey, type RoomViewHooks } from './RoomView';
import { esc, ot, type OKey } from './strings';

type Tab = 'play' | 'rank' | 'profile';

/**
 * Full-screen online panel layered over the offline game.
 * Owns the backend connection, the signed-in player's profile and the
 * current room (if any).
 */
export class OnlineHub {
  private el: HTMLElement;
  be: Backend | null = null;
  profile: ProfileService | null = null;
  room: RoomView | null = null;
  /** Extra hooks for the room screen (phase 3 adds the match). */
  roomHooks: Partial<RoomViewHooks> = {};

  private tab: Tab = 'play';
  private state: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  private offs: Unsub[] = [];
  private rooms: { id: string; entry: RoomIndexEntry }[] | null = null;

  constructor() {
    this.el = document.getElementById('online')!;
    this.el.addEventListener('click', (e) => void this.onClick(e));
  }

  get isOpen() {
    return !this.el.hidden;
  }

  async open() {
    this.show();
    if (this.state === 'ready') return this.render();
    await this.connect();
  }

  /** Open straight into a room from an invite link (#/r/CODE). */
  async openWithCode(code: string) {
    await this.open();
    if (this.state === 'ready') await this.joinByCode(code);
  }

  show() {
    this.el.hidden = false;
    document.body.classList.add('online-open');
  }

  hide() {
    this.el.hidden = true;
    document.body.classList.remove('online-open');
  }

  close() {
    if (this.room) return; // must leave the room first
    this.hide();
    if (location.hash.startsWith('#/')) history.replaceState(null, '', location.pathname + location.search);
  }

  private async connect() {
    this.state = 'loading';
    this.render();
    try {
      this.be = await getBackend();
      this.profile = new ProfileService(this.be);
      await withTimeout(this.profile.init(), 15_000);
      this.offs.push(startPresence(this.be.db, this.profile.uid));
      this.offs.push(
        this.profile.onChange(() => {
          if (this.state !== 'ready') return;
          this.renderHeader();
          if (this.room) void this.room.session.updateMe(this.me());
        }),
      );
      this.state = 'ready';
    } catch (e) {
      console.error('[online] connect failed', e);
      this.state = 'error';
    }
    this.render();
  }

  me(): MemberInfo {
    const p = this.profile!.profile!;
    return { name: p.name, avatar: p.avatar, country: p.country, rating: this.profile!.stats?.rating ?? 1000 };
  }

  /* ------------------------------------------------------------- rooms */

  async enterRoom(roomId: string) {
    const host = document.createElement('div');
    host.className = 'hub room-host';
    const view = new RoomView(host, this.be!, this.profile!.uid, roomId, this.me(), {
      ...this.roomHooks,
      onExit: (reason) => {
        this.room = null;
        if (location.hash.startsWith('#/r/')) history.replaceState(null, '', location.pathname + location.search);
        this.roomHooks.onExit?.(reason);
        this.show();
        this.render();
        void this.refreshRooms();
      },
    });
    try {
      await view.open();
    } catch (e) {
      toast(e instanceof RoomError ? ot(roomErrKey(e.code)) : ot('connectFail'), 2500);
      return;
    }
    this.room = view;
    this.el.innerHTML = '';
    this.el.appendChild(host);
    const code = view.session.meta?.code;
    if (code) history.replaceState(null, '', `${location.pathname}${location.search}#/r/${code}`);
  }

  private async joinByCode(code: string) {
    const id = await findRoomByCode(this.be!, code);
    if (!id) return toast(ot('room.notFound'));
    await this.enterRoom(id);
  }

  private async refreshRooms() {
    if (!this.be || this.room) return;
    try {
      this.rooms = await listPublicRooms(this.be);
    } catch (e) {
      console.warn('[online] list rooms failed', e);
      this.rooms = [];
    }
    if (this.tab === 'play' && !this.room) this.renderBody();
  }

  private createRoomDialog() {
    const name = ot('room.defaultName', { name: this.profile!.profile!.name });
    const m = showModal({
      title: ot('room.createT'),
      body: `<label class="fld"><span>${ot('room.name')}</span><input id="crName" maxlength="24" value="${esc(name)}" /></label>
        <div class="vis-pick">
          <label><input type="radio" name="vis" value="public" checked /><span><b>🌐 ${ot('room.public')}</b><small>${ot('room.publicSub')}</small></span></label>
          <label><input type="radio" name="vis" value="private" /><span><b>🔒 ${ot('room.private')}</b><small>${ot('room.privateSub')}</small></span></label>
        </div>`,
      buttons: [
        { label: ot('cancel') },
        {
          label: ot('room.create'),
          kind: 'primary',
          onClick: () => {
            const n = (m.querySelector('#crName') as HTMLInputElement).value;
            const vis = (m.querySelector('input[name=vis]:checked') as HTMLInputElement).value as 'public' | 'private';
            void (async () => {
              try {
                const id = await createRoom(this.be!, this.profile!.uid, this.me(), { name: n || name, visibility: vis });
                await this.enterRoom(id);
              } catch (e) {
                toast(e instanceof RoomError ? ot(roomErrKey(e.code)) : ot('connectFail'));
              }
            })();
          },
        },
      ],
    });
  }

  private joinDialog() {
    const m = showModal({
      title: ot('room.joinT'),
      body: `<label class="fld"><input id="jnCode" maxlength="6" placeholder="${ot('room.codePh')}" class="code-in" autocomplete="off" spellcheck="false" /></label>`,
      buttons: [
        { label: ot('cancel') },
        {
          label: ot('room.join'),
          kind: 'primary',
          onClick: () => void this.joinByCode((m.querySelector('#jnCode') as HTMLInputElement).value),
        },
      ],
    });
    const input = m.querySelector<HTMLInputElement>('#jnCode')!;
    input.focus();
    input.oninput = () => (input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  }

  /* ------------------------------------------------------------ render */

  private render() {
    if (this.room) return; // the room view owns the panel
    if (this.state === 'loading' || this.state === 'idle') {
      this.el.innerHTML = `<div class="hub"><div class="hub-top">${this.backBtn()}</div><div class="hub-center"><div class="spinner"></div><p>${ot('loading')}</p></div></div>`;
      return;
    }
    if (this.state === 'error') {
      this.el.innerHTML = `<div class="hub"><div class="hub-top">${this.backBtn()}</div><div class="hub-center"><p>${ot('connectFail')}</p><button class="btn primary" data-act="retry">${ot('retry')}</button></div></div>`;
      return;
    }
    this.el.innerHTML = `<div class="hub">
      <div class="hub-top">${this.backBtn()}<div class="hub-me" id="hubMe"></div></div>
      ${this.be!.mode === 'local' ? `<div class="hub-note">🧪 ${ot('localMode')}</div>` : ''}
      <nav class="hub-tabs">${(['play', 'rank', 'profile'] as Tab[])
        .map((t) => `<button data-act="tab" data-tab="${t}" class="${this.tab === t ? 'on' : ''}">${ot(`tab.${t}` as OKey)}</button>`)
        .join('')}</nav>
      <section class="hub-body" id="hubBody"></section>
    </div>`;
    this.renderHeader();
    this.renderBody();
    if (this.tab === 'play' && this.rooms === null) void this.refreshRooms();
  }

  private backBtn() {
    return `<button class="ib" data-act="close" aria-label="${ot('back')}" title="${ot('back')}">
      <svg class="ic" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  }

  private renderHeader() {
    const me = this.el.querySelector('#hubMe');
    const p = this.profile?.profile;
    const s = this.profile?.stats;
    if (!me || !p) return;
    me.innerHTML = `<span class="av">${avatarOf(p.avatar)}</span>
      <span class="me-name">${esc(p.name)} <span class="flag">${flagOf(p.country)}</span></span>
      <span class="me-rating">${s ? s.rating : '—'}</span>`;
  }

  private renderBody() {
    const body = this.el.querySelector<HTMLElement>('#hubBody');
    if (!body) return;
    if (this.tab === 'play') body.innerHTML = this.playTab();
    else if (this.tab === 'rank') body.innerHTML = `<div class="hub-center"><p>🏆 ${ot('tab.rank')} — ${ot('soon')}</p></div>`;
    else {
      body.innerHTML = this.profileTab();
      this.bindProfileInputs();
    }
  }

  private playTab() {
    const card = (act: string, icon: string, title: OKey, sub: OKey | null, disabled: boolean) =>
      `<button class="play-card" data-act="${act}" ${disabled ? 'disabled' : ''}>
        <span class="pc-ic">${icon}</span>
        <span class="pc-txt"><b>${ot(title)}</b>${sub ? `<small>${ot(sub)}</small>` : ''}</span>
        ${disabled ? `<span class="soon">${ot('soon')}</span>` : ''}
      </button>`;
    const list =
      this.rooms === null
        ? `<div class="hub-center"><div class="spinner"></div></div>`
        : this.rooms.length === 0
          ? `<p class="muted center">${ot('play.noRooms')}</p>`
          : this.rooms
              .map(
                ({ id, entry: r }) => `<button class="room-row" data-act="enter" data-id="${esc(id)}">
              <span class="rr-main"><b>${esc(r.name)}</b><small>👑 ${esc(r.hostName)}</small></span>
              <span class="rr-meta"><span>${ot('room.players', { n: r.players })}</span><span>${ot('room.watching', { n: r.spectators })}</span></span>
              <span class="badge ${r.status}">${ot(r.status === 'playing' ? 'room.statusPlaying' : 'room.statusWaiting')}</span>
            </button>`,
              )
              .join('');
    return `<div class="play-grid">
      ${card('quick', '⚔️', 'play.quick', 'play.quickSub', true)}
      <div class="play-row">
        ${card('create', '🏠', 'play.create', 'play.createSub', false)}
        ${card('join', '🔑', 'play.join', null, false)}
      </div>
    </div>
    <div class="list-head"><h4>${ot('play.rooms')}</h4><button class="btn sm" data-act="refresh">↻ ${ot('play.refresh')}</button></div>
    <div class="room-list">${list}</div>`;
  }

  private profileTab() {
    const p = this.profile!.profile!;
    const s = this.profile!.stats!;
    const u = this.profile!.user!;
    const wr = s.games ? Math.round((s.w / s.games) * 100) : 0;
    return `<div class="prof">
      <div class="stat-grid">
        <div><b>${s.rating}</b><span>${ot('rating')}</span></div>
        <div><b>${s.games}</b><span>${ot('games')}</span></div>
        <div><b>${wr}%</b><span>${ot('winRate')}</span></div>
      </div>
      <label class="fld"><span>${ot('profile.name')}</span>
        <div class="row-in"><input id="pfName" maxlength="16" value="${esc(p.name)}" autocomplete="off" spellcheck="false" />
        <button class="btn primary" data-act="saveName">${ot('profile.save')}</button></div>
        <small class="err" id="pfErr"></small>
      </label>
      <div class="fld"><span>${ot('profile.avatar')}</span>
        <div class="av-grid">${AVATARS.map((a, i) => `<button data-act="avatar" data-i="${i}" class="${i === p.avatar ? 'on' : ''}">${a}</button>`).join('')}</div>
      </div>
      <label class="fld"><span>${ot('profile.country')}</span>
        <select id="pfCountry">${COUNTRIES.map((c) => `<option value="${c}" ${c === p.country ? 'selected' : ''}>${flagOf(c)} ${esc(countryName(c))}</option>`).join('')}</select>
      </label>
      <div class="fld"><span>${ot('profile.account')}</span>
        ${
          u.isAnonymous
            ? `<p class="muted">${ot('profile.guest')}</p><button class="btn google" data-act="link"><b>G</b> ${ot('profile.link')}</button>`
            : `<p class="muted">✅ ${esc(ot('profile.linkedAs', { email: u.email ?? '' }))}</p>`
        }
      </div>
      <p class="uid">${ot('profile.id')}: <code>${esc(u.uid)}</code></p>
    </div>`;
  }

  /* ------------------------------------------------------------ events */

  private async onClick(e: MouseEvent) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t || (t as HTMLButtonElement).disabled || this.room?.session && t.closest('.room')) return;
    const act = t.dataset.act!;
    sfx.click();
    switch (act) {
      case 'close':
        return this.close();
      case 'retry':
        return this.connect();
      case 'tab':
        this.tab = t.dataset.tab as Tab;
        this.el.querySelectorAll('.hub-tabs button').forEach((b) => b.classList.toggle('on', b === t));
        return this.renderBody();
      case 'create':
        return this.createRoomDialog();
      case 'join':
        return this.joinDialog();
      case 'enter':
        return this.enterRoom(t.dataset.id!);
      case 'refresh':
        this.rooms = null;
        this.renderBody();
        return this.refreshRooms();
      case 'saveName':
        return this.saveName();
      case 'avatar':
        await this.profile!.update({ avatar: Number(t.dataset.i) });
        return this.renderBody();
      case 'link':
        return this.link();
    }
  }

  private bindProfileInputs() {
    const sel = this.el.querySelector<HTMLSelectElement>('#pfCountry');
    if (sel) sel.onchange = () => void this.profile!.update({ country: sel.value });
  }

  private async saveName() {
    const input = this.el.querySelector<HTMLInputElement>('#pfName')!;
    const err = this.el.querySelector<HTMLElement>('#pfErr')!;
    try {
      await this.profile!.update({ name: input.value });
      err.textContent = '';
      toast(ot('profile.saved'));
    } catch (e) {
      err.textContent = e instanceof ProfileError ? ot(e.code as OKey) : String(e);
    }
  }

  private async link() {
    const res = await this.profile!.linkGoogle(
      () =>
        new Promise<boolean>((resolve) =>
          showModal({
            title: ot('profile.switchT'),
            body: ot('profile.switchB'),
            bodyCenter: true,
            dismissible: false,
            buttons: [
              { label: ot('cancel'), onClick: () => resolve(false) },
              { label: ot('profile.switch'), kind: 'primary', onClick: () => resolve(true) },
            ],
          }),
        ),
    );
    if (res.status === 'linked') toast(ot('profile.linked'));
    else if (res.status === 'switched') toast(ot('profile.switched'));
    else if (res.status === 'error') toast(ot('profile.linkFail', { msg: res.message }), 3000);
    this.render();
  }

  /** Re-render after a language change. */
  refresh() {
    if (this.isOpen && !this.room) this.render();
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), ms);
    p.then(
      (v) => (clearTimeout(t), res(v)),
      (e) => (clearTimeout(t), rej(e)),
    );
  });
}

function countryName(cc: string): string {
  try {
    return new Intl.DisplayNames([getLang()], { type: 'region' }).of(cc) ?? cc;
  } catch {
    return cc;
  }
}
