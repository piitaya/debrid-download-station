import { createHash, randomBytes } from 'node:crypto';
import type { JsonFile } from './storage.js';

export interface StoredSession {
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

export type SessionMap = Record<string, StoredSession>;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const TOUCH_INTERVAL = 60 * 60 * 1000;

/** Browser sessions. The cookie holds a random token; only its hash is stored on disk. */
export class Sessions {
  constructor(
    private readonly file: JsonFile<SessionMap>,
    private readonly ttlMs: number,
  ) {
    this.purgeExpired();
  }

  private get map(): SessionMap {
    return this.file.data;
  }

  create(): { token: string; session: StoredSession } {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const session: StoredSession = { createdAt: now, lastSeenAt: now, expiresAt: now + this.ttlMs };
    this.map[hashToken(token)] = session;
    this.file.save();
    return { token, session };
  }

  /** Returns the session for a cookie token and extends it (sliding expiration). */
  get(token: string | undefined): StoredSession | null {
    if (!token) return null;
    const key = hashToken(token);
    const session = this.map[key];
    if (!session) return null;
    const now = Date.now();
    if (session.expiresAt <= now) {
      delete this.map[key];
      this.file.save();
      return null;
    }
    if (now - session.lastSeenAt > TOUCH_INTERVAL) {
      session.lastSeenAt = now;
      session.expiresAt = now + this.ttlMs;
      this.file.save();
    }
    return session;
  }

  delete(token: string | undefined): void {
    if (!token) return;
    const key = hashToken(token);
    if (!this.map[key]) return;
    delete this.map[key];
    this.file.save();
  }

  /** Signs out every device (new account, new password). */
  clear(): void {
    this.file.data = {};
    this.file.save();
  }

  purgeExpired(): void {
    const now = Date.now();
    let changed = false;
    for (const [key, session] of Object.entries(this.map)) {
      if (session.expiresAt <= now) {
        delete this.map[key];
        changed = true;
      }
    }
    if (changed) this.file.save();
  }
}
