import { sfx } from '../audio';
import { getLang } from '../i18n';
import type { Unsub } from '../net/db';
import { ProfileError } from '../net/profile';
import { myRank, recentHistory } from '../net/rating';
import { AVATARS, COUNTRIES, avatarOf, flagOf, type HistoryEntry } from '../net/schema';
import { showModal, toast } from '../ui/modal';
import type { OnlineHub } from './OnlineHub';
import { esc, ot, type OKey } from './strings';
import { tierBadge, tierCard } from './tierBadge';

/** Offline results vs the built-in bot (kept by App in localStorage). */
export interface LocalBotStats {
  easy: { w: number; l: number; d: number };
  medium: { w: number; l: number; d: number };
  hard: { w: number; l: number; d: number };
  streak: number;
  best: number;
}

/**
 * Stand-alone player profile page (opened from the top bar or the online
 * hub header). Shows online rank/stats/history when connected, the offline
 * record vs the bot always, and lets the player edit name/avatar/country.
 */
export class ProfilePage {
  private el: HTMLElement;
  private history: (HistoryEntry & { id: string })[] | null = null;
  private rank: number | null | undefined = undefined;
  private online: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  private off: Unsub | null = null;

  constructor(
    private hub: OnlineHub,
    private localStats: () => LocalBotStats,
  ) {
    this.el = document.getElementById('profilePage')!;
    this.el.addEventListener('click', (e) => void this.onClick(e));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen && !document.getElementById('overlay')!.classList.contains('open')) this.close();
    });
  }

  get isOpen() {
    return !this.el.hidden;
  }

  async open() {
    this.el.hidden = false;
    document.body.classList.add('profile-open');
    this.hub.wake();
    this.history = null;
    this.rank = undefined;
    if (this.online !== 'ready') this.online = 'loading';
    this.render();
    await this.connect();
  }

  close() {
    this.el.hidden = true;
    document.body.classList.remove('profile-open');
    this.off?.();
    this.off = null;
    if (!this.hub.isOpen) this.hub.scheduleIdleDisconnect(30_000);
  }

  private async connect() {
    const ok = await this.hub.ensureReady();
    this.online = ok ? 'ready' : 'error';
    this.render();
    if (!ok) return;
    this.off?.();
    this.off = this.hub.profile!.onChange(() => this.isOpen && this.renderKeepInputs());
    const be = this.hub.be!;
    const uid = this.hub.profile!.uid;
    const [rank, history] = await Promise.all([
      myRank(be, uid).catch(() => null),
      recentHistory(be, uid).catch(() => []),
    ]);
    this.rank = rank;
    this.history = history;
    if (this.isOpen) this.renderKeepInputs();
  }

  /** Re-render without losing a half-typed name. */
  private renderKeepInputs() {
    const typed = this.el.querySelector<HTMLInputElement>('#pfName');
    const value = typed && document.activeElement === typed ? typed.value : null;
    this.render();
    if (value !== null) {
      const input = this.el.querySelector<HTMLInputElement>('#pfName');
      if (input) {
        input.value = value;
        input.focus();
      }
    }
  }

  /* ------------------------------------------------------------ render */

  private render() {
    this.el.innerHTML = `<div class="hub profile">
      <div class="hub-top">
        <button class="ib" data-act="close" aria-label="${ot('back')}" title="${ot('back')}">
          <svg class="ic" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <h2 class="page-title">${ot('tab.profile')}</h2>
      </div>
      <section class="profile-body">${this.body()}</section>
    </div>`;
    this.bindInputs();
  }

  private body() {
    const ready = this.online === 'ready' && this.hub.profile?.profile && this.hub.profile.stats;
    return `${ready ? this.hero() : this.offlineHero()}
      <div class="pf-grid">
        <div class="pf-col">
          ${ready ? this.onlineStats() : this.onlineState()}
          ${this.offlineStats()}
        </div>
        <div class="pf-col">
          ${ready ? this.historyCard() : ''}
          ${ready ? this.editCard() : ''}
        </div>
      </div>`;
  }

  private hero() {
    const p = this.hub.profile!.profile!;
    const s = this.hub.profile!.stats!;
    const pos = this.rank ? `#${this.rank}` : s.games ? '1000+' : ot('rank.unranked');
    return `<div class="pf-hero">
      <button class="pf-avatar" data-act="pickAvatar" title="${ot('profile.avatar')}">${avatarOf(p.avatar)}<i>✎</i></button>
      <div class="pf-id">
        <h3>${esc(p.name)}</h3>
        <div class="pf-meta">
          <span>${flagOf(p.country)} ${esc(countryName(p.country))}</span>
          ${tierBadge(s.rating, this.rank ?? undefined)}
        </div>
      </div>
      <div class="pf-rank"><small>${ot('rank.me')}</small><b>${pos}</b></div>
    </div>`;
  }

  private offlineHero() {
    return `<div class="pf-hero">
      <div class="pf-avatar">🙂</div>
      <div class="pf-id"><h3>${ot('profile.guestTitle')}</h3><div class="pf-meta"><span class="muted">${ot('profile.offlineOnly')}</span></div></div>
    </div>`;
  }

  private onlineState() {
    if (this.online === 'loading') return `<div class="pf-card center"><div class="spinner"></div><p class="muted">${ot('loading')}</p></div>`;
    return `<div class="pf-card center"><p class="muted">${ot('busy')}</p><button class="btn" data-act="retry">${ot('retry')}</button></div>`;
  }

  private onlineStats() {
    const s = this.hub.profile!.stats!;
    const wr = s.games ? Math.round((s.w / s.games) * 100) : 0;
    return `<div class="pf-card">
      <h4>${ot('profile.ranked')}</h4>
      ${tierCard(s.rating, this.rank ?? undefined)}
      <div class="stat-grid">
        <div><b>${s.games}</b><span>${ot('games')}</span></div>
        <div><b>${wr}%</b><span>${ot('winRate')}</span></div>
        <div><b>${s.peak}</b><span>${ot('rank.peak')}</span></div>
        <div><b>${s.w}<i>/</i>${s.l}<i>/</i>${s.d}</b><span>${ot('rank.wld')}</span></div>
        <div><b>${s.streak}</b><span>${ot('rank.streak')}</span></div>
        <div><b>${s.bestStreak}</b><span>${ot('rank.best')}</span></div>
      </div>
    </div>`;
  }

  private offlineStats() {
    const s = this.localStats();
    const rows = (['easy', 'medium', 'hard'] as const)
      .map(
        (l) =>
          `<tr><td>${ot(`profile.lv.${l}` as OKey)}</td><td class="w">${s[l].w}</td><td class="l">${s[l].l}</td><td>${s[l].d}</td></tr>`,
      )
      .join('');
    return `<div class="pf-card">
      <h4>🤖 ${ot('profile.vsBot')}</h4>
      <table class="stat-table"><tr><th></th><th>${ot('profile.w')}</th><th>${ot('profile.l')}</th><th>${ot('profile.d')}</th></tr>${rows}</table>
      <p class="muted small">🔥 ${ot('rank.streak')}: <b>${s.streak}</b> · ${ot('rank.best')}: <b>${s.best}</b></p>
    </div>`;
  }

  private historyCard() {
    let list: string;
    if (this.history === null) list = `<div class="center"><div class="spinner"></div></div>`;
    else if (!this.history.length) list = `<p class="muted">${ot('rank.noHistory')}</p>`;
    else
      list = `<div class="hist">${this.history
        .map(
          (h) => `<div class="hist-row ${h.res}">
          <span class="hr-res">${h.res === 'w' ? 'W' : h.res === 'l' ? 'L' : 'D'}</span>
          <span class="hr-opp">${esc(h.opp)} <small>(${h.oppRating})</small></span>
          <span class="hr-delta">${h.delta > 0 ? '+' : ''}${h.delta}</span>
          <span class="hr-after">${h.after}</span>
        </div>`,
        )
        .join('')}</div>`;
    return `<div class="pf-card"><h4>${ot('rank.history')}</h4>${list}</div>`;
  }

  private editCard() {
    const p = this.hub.profile!.profile!;
    const u = this.hub.profile!.user!;
    return `<div class="pf-card" id="pfEdit">
      <h4>${ot('profile.edit')}</h4>
      <label class="fld"><span>${ot('profile.name')}</span>
        <div class="row-in"><input id="pfName" maxlength="16" value="${esc(p.name)}" autocomplete="off" spellcheck="false" />
        <button class="btn primary" data-act="saveName">${ot('profile.save')}</button></div>
        <small class="err" id="pfErr"></small>
      </label>
      <div class="fld" id="pfAvatars"><span>${ot('profile.avatar')}</span>
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

  private bindInputs() {
    const sel = this.el.querySelector<HTMLSelectElement>('#pfCountry');
    if (sel) sel.onchange = () => void this.hub.profile!.update({ country: sel.value });
    const name = this.el.querySelector<HTMLInputElement>('#pfName');
    if (name)
      name.onkeydown = (e) => {
        if (e.key === 'Enter') void this.saveName();
      };
  }

  private async onClick(e: MouseEvent) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t || (t as HTMLButtonElement).disabled) return;
    sfx.click();
    switch (t.dataset.act) {
      case 'close':
        return this.close();
      case 'retry':
        this.online = 'loading';
        this.render();
        return this.connect();
      case 'pickAvatar':
        this.el.querySelector('#pfAvatars')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      case 'avatar':
        await this.hub.profile!.update({ avatar: Number(t.dataset.i) });
        return;
      case 'saveName':
        return this.saveName();
      case 'link':
        return this.link();
    }
  }

  private async saveName() {
    const input = this.el.querySelector<HTMLInputElement>('#pfName')!;
    const err = this.el.querySelector<HTMLElement>('#pfErr')!;
    try {
      await this.hub.profile!.update({ name: input.value });
      err.textContent = '';
      input.blur();
      toast(ot('profile.saved'));
    } catch (e) {
      err.textContent = e instanceof ProfileError ? ot(e.code as OKey) : String(e);
    }
  }

  private async link() {
    const res = await this.hub.profile!.linkGoogle(
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

function countryName(cc: string): string {
  try {
    return new Intl.DisplayNames([getLang()], { type: 'region' }).of(cc) ?? cc;
  } catch {
    return cc;
  }
}
