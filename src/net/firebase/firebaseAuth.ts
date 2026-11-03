import type { FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  linkWithPopup,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCredential,
  type Auth,
  type User,
} from 'firebase/auth';
import type { AuthService, AuthUser, LinkResult } from '../auth';
import type { Unsub } from '../db';

const toUser = (u: User): AuthUser => {
  const google = u.providerData.find((p) => p.providerId === 'google.com');
  return {
    uid: u.uid,
    isAnonymous: u.isAnonymous,
    email: google?.email ?? u.email ?? null,
    googleName: google?.displayName ?? null,
  };
};

export class FirebaseAuthService implements AuthService {
  private auth: Auth;
  user: AuthUser | null = null;
  private ready: Promise<void>;

  constructor(app: FirebaseApp) {
    this.auth = getAuth(app);
    this.ready = new Promise((res) => {
      const off = onAuthStateChanged(this.auth, (u) => {
        this.user = u ? toUser(u) : null;
        off();
        res();
      });
    });
    onAuthStateChanged(this.auth, (u) => {
      this.user = u ? toUser(u) : null;
    });
  }

  async ensureSignedIn(): Promise<AuthUser> {
    await this.ready;
    if (this.auth.currentUser) return (this.user = toUser(this.auth.currentUser));
    const cred = await signInAnonymously(this.auth);
    return (this.user = toUser(cred.user));
  }

  async linkGoogle(confirmSwitch: () => Promise<boolean>): Promise<LinkResult> {
    const current = this.auth.currentUser ?? (await this.ensureSignedIn(), this.auth.currentUser!);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      const res = await linkWithPopup(current, provider);
      await res.user.reload();
      return { status: 'linked', user: (this.user = toUser(this.auth.currentUser ?? res.user)) };
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      if (code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use') {
        const cred = GoogleAuthProvider.credentialFromError(e as never);
        if (!cred) return { status: 'error', message: code };
        if (!(await confirmSwitch())) return { status: 'cancelled' };
        const res = await signInWithCredential(this.auth, cred);
        return { status: 'switched', user: (this.user = toUser(res.user)) };
      }
      if (code === 'auth/provider-already-linked') return { status: 'linked', user: this.user! };
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request')
        return { status: 'cancelled' };
      return { status: 'error', message: code || String(e) };
    }
  }

  onChange(cb: (u: AuthUser | null) => void): Unsub {
    return onAuthStateChanged(this.auth, (u) => cb(u ? toUser(u) : null));
  }
}
