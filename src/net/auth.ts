import type { Unsub } from './db';

export interface AuthUser {
  uid: string;
  isAnonymous: boolean;
  email: string | null;
  googleName: string | null;
}

export type LinkResult =
  | { status: 'linked'; user: AuthUser }
  | { status: 'switched'; user: AuthUser }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export interface AuthService {
  readonly user: AuthUser | null;
  /** Signs in anonymously on first use; later calls return the same uid. */
  ensureSignedIn(): Promise<AuthUser>;
  /**
   * Attach a Google account to the current (anonymous) user, keeping the uid.
   * If that Google account already belongs to another user, `confirmSwitch`
   * decides whether to switch to that account instead.
   */
  linkGoogle(confirmSwitch: () => Promise<boolean>): Promise<LinkResult>;
  onChange(cb: (u: AuthUser | null) => void): Unsub;
}

/* ------------------------------------------------------------ local fake */

/**
 * Dev / test auth. The uid lives in sessionStorage so every browser TAB is a
 * different player – handy for testing rooms with several tabs.
 */
export class LocalAuth implements AuthService {
  user: AuthUser | null = null;
  private subs = new Set<(u: AuthUser | null) => void>();

  constructor(private fixedUid?: string) {}

  async ensureSignedIn(): Promise<AuthUser> {
    if (this.user) return this.user;
    let uid = this.fixedUid;
    if (!uid) {
      try {
        uid = sessionStorage.getItem('infinite-xo:local-uid') ?? undefined;
        if (!uid) {
          uid = 'local-' + Math.random().toString(36).slice(2, 10);
          sessionStorage.setItem('infinite-xo:local-uid', uid);
        }
      } catch {
        uid = 'local-' + Math.random().toString(36).slice(2, 10);
      }
    }
    this.user = { uid, isAnonymous: true, email: null, googleName: null };
    for (const fn of this.subs) fn(this.user);
    return this.user;
  }

  async linkGoogle(): Promise<LinkResult> {
    const u = await this.ensureSignedIn();
    this.user = { ...u, isAnonymous: false, email: 'demo@local.test', googleName: 'Demo User' };
    for (const fn of this.subs) fn(this.user);
    return { status: 'linked', user: this.user };
  }

  onChange(cb: (u: AuthUser | null) => void): Unsub {
    this.subs.add(cb);
    cb(this.user);
    return () => this.subs.delete(cb);
  }
}
