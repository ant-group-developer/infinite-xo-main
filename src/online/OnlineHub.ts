import { sfx } from '../audio';
import { getBackend, type Backend } from '../net/backend';
import type { Unsub } from '../net/db';
import { startPresence } from '../net/presence';
import { ProfileError, ProfileService } from '../net/profile';
import { AVATARS, COUNTRIES, avatarOf, flagOf } from '../net/schema';
import { showModal, toast } from '../ui/modal';
import { getLang } from '../i18n';
import { esc, ot, type OKey } from './strings';

type Tab = 'play' | 'rank' | 'profile';

/**
 * Full-screen online panel layered over the offline game.
 * Owns the backend connection + the signed-in player's profile.
 */
export class OnlineHub {
  private el: HTMLElement;
  be: Backend | null = null;
  profile: ProfileService | null = null;
  private tab: Tab = 'play';
  private state: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  private offs: Unsub[] = [];

  constructor() {
    this.el = document.getElementById('online')!;
    this.el.addEventListener('click', (e) => this.onClick(e));
  }

  get isOpen() {
    return !this.el.hidden;
  }

  async open() {
    this.el.hidden = false;
    document.body.classList.add('online-open');
    if (this.state === 'ready') return this.render();
    await this.connect();
  }

  close() {
    this.el.hidden = true;
    document.body.classList.remove('online-open');
  }

  private async connect() {
    this.state = 'loading';
    this.render();
    try {
      this.be = await getBackend();
      this.profile = new ProfileService(this.be);
      await withTimeout(this.profile.init(), 15_000);
      this.offs.push(startPresence(this.be.db, this.profile.uid));
      this.offs.push(this.profile.onChange(() => this.state === 'ready' && this.renderHeader()));
      this.state = 'ready';
    } catch (e) {
      console.error('[online] connect failed', e);
      this.state = 'error';
    }
    this.render();
  }

  /* ------------------------------------------------------------ render */

  private render() {
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
    return `<div class="play-grid">
      ${card('quick', '⚔️', 'play.quick', 'play.quickSub', true)}
      ${card('create', '🏠', 'play.create', 'play.createSub', true)}
      ${card('join', '🔑', 'play.join', null, true)}
    </div>`;
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
    if (!t || (t as HTMLButtonElement).disabled) return;
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
    if (this.isOpen) this.render();
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
