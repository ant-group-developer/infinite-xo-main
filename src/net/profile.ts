import type { AuthUser } from './auth';
import type { Backend } from './backend';
import { SERVER_TS, type Unsub } from './db';
import { validateName } from './filter';
import { freshStats, guessCountry, type PlayerStats, type UserProfile } from './schema';

export class ProfileError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Signs in (anonymous on first visit) and makes sure /users and /stats rows exist. */
export class ProfileService {
  user: AuthUser | null = null;
  profile: UserProfile | null = null;
  stats: PlayerStats | null = null;
  private subs = new Set<() => void>();
  private offs: Unsub[] = [];

  constructor(private be: Backend) {}

  get uid(): string {
    if (!this.user) throw new Error('not signed in');
    return this.user.uid;
  }

  onChange(fn: () => void): Unsub {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  private emit() {
    for (const fn of this.subs) fn();
  }

  async init(): Promise<UserProfile> {
    this.user = await this.be.auth.ensureSignedIn();
    await this.ensureRows();
    this.watch();
    return this.profile!;
  }

  private async ensureRows() {
    const { db } = this.be;
    const uid = this.uid;
    let profile = await db.get<UserProfile>(`users/${uid}`);
    if (!profile) {
      profile = {
        name: `Khách#${String(Math.floor(1000 + Math.random() * 9000))}`,
        avatar: Math.floor(Math.random() * 24),
        country: guessCountry(),
        createdAt: SERVER_TS,
        linked: !this.user!.isAnonymous,
      };
      await db.set(`users/${uid}`, profile);
      profile = (await db.get<UserProfile>(`users/${uid}`))!;
    }
    let stats = await db.get<PlayerStats>(`stats/${uid}`);
    if (!stats) {
      stats = freshStats(profile);
      await db.set(`stats/${uid}`, stats);
    }
    this.profile = profile;
    this.stats = stats;
  }

  private watch() {
    for (const off of this.offs) off();
    const { db } = this.be;
    this.offs = [
      db.onValue<UserProfile>(`users/${this.uid}`, (p) => {
        if (p) this.profile = p;
        this.emit();
      }),
      db.onValue<PlayerStats>(`stats/${this.uid}`, (s) => {
        if (s) this.stats = s;
        this.emit();
      }),
    ];
  }

  /** Update name / avatar / country (also mirrored into /stats for the leaderboard). */
  async update(patch: Partial<Pick<UserProfile, 'name' | 'avatar' | 'country'>>) {
    if (patch.name !== undefined) {
      const err = validateName(patch.name);
      if (err) throw new ProfileError(`name.${err}`);
      patch.name = patch.name.trim();
    }
    const uid = this.uid;
    const up: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      up[`users/${uid}/${k}`] = v;
      up[`stats/${uid}/${k}`] = v;
    }
    await this.be.db.update(up);
  }

  async linkGoogle(confirmSwitch: () => Promise<boolean>) {
    const res = await this.be.auth.linkGoogle(confirmSwitch);
    if (res.status === 'linked') {
      this.user = res.user;
      await this.be.db.update({ [`users/${res.user.uid}/linked`]: true });
    } else if (res.status === 'switched') {
      // Different uid now: load (or create) that account's rows.
      this.user = res.user;
      await this.ensureRows();
      if (!this.profile!.linked) await this.be.db.update({ [`users/${res.user.uid}/linked`]: true });
      this.watch();
    }
    this.emit();
    return res;
  }

  dispose() {
    for (const off of this.offs) off();
    this.offs = [];
  }
}
