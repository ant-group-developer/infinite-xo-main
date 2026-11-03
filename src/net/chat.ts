import type { Backend } from './backend';
import { SERVER_TS, type Unsub } from './db';
import { cleanText } from './filter';
import { CHAT_MAX, type ChatMessage } from './schema';

const MIN_INTERVAL = 1000;
const HISTORY = 50;

/** Room chat: last 50 messages, 1 message/second, profanity masked. */
export class ChatService {
  private lastSent = 0;
  private muted: Set<string>;

  constructor(
    private be: Backend,
    private roomId: string,
    private uid: string,
  ) {
    this.muted = new Set(loadMuted());
  }

  subscribe(cb: (id: string, m: ChatMessage) => void): Unsub {
    return this.be.db.onChildAdded<ChatMessage>(
      `roomChat/${this.roomId}`,
      (id, m) => {
        if (!this.muted.has(m.uid)) cb(id, m);
      },
      { limitToLast: HISTORY },
    );
  }

  /** Returns false when rate-limited or empty. */
  async send(name: string, raw: string): Promise<boolean> {
    const text = cleanText(raw.trim()).slice(0, CHAT_MAX);
    if (!text) return false;
    const now = Date.now();
    if (now - this.lastSent < MIN_INTERVAL) return false;
    this.lastSent = now;
    const id = this.be.db.pushKey(`roomChat/${this.roomId}`);
    await this.be.db.set(`roomChat/${this.roomId}/${id}`, {
      uid: this.uid,
      name,
      text,
      t: SERVER_TS,
    } satisfies ChatMessage);
    return true;
  }

  isMuted(uid: string) {
    return this.muted.has(uid);
  }

  toggleMute(uid: string) {
    if (this.muted.has(uid)) this.muted.delete(uid);
    else this.muted.add(uid);
    saveMuted([...this.muted]);
    return this.muted.has(uid);
  }
}

const KEY = 'infinite-xo:muted';
function loadMuted(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}
function saveMuted(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-200)));
  } catch {
    /* ignore */
  }
}
