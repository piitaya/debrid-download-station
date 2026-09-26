import { createHash, randomBytes } from 'node:crypto';
import type { JsonFile } from './storage.js';

export interface StoredSession {
  username: string;
  /** DSM session id, used for every NAS call made on behalf of this user. */
  dsmSid: string;
  /** False once DSM rejected the sid: the user has to log in again. */
  dsmValid: boolean;
  /** DSM administrator (Download Station manager). */
  isManager: boolean;
  /** Encrypted login, to log in to DSM again when it drops the session (see NasLogins). */
  credentials?: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

export type SessionMap = Record<string, StoredSession>;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const TOUCH_INTERVAL = 60 * 60 * 1000;

/**
 * Browser sessions. The cookie holds a random token; only its hash is stored on disk, next to
 * the DSM sid obtained at login and the encrypted login used to renew it.
 */
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

  create(
    username: string,
    dsmSid: string,
    isManager: boolean,
    credentials?: string,
  ): { token: string; session: StoredSession } {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const session: StoredSession = {
      username,
      dsmSid,
      dsmValid: true,
      isManager,
      ...(credentials ? { credentials } : {}),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + this.ttlMs,
    };
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

  delete(token: string | undefined): StoredSession | null {
    if (!token) return null;
    const key = hashToken(token);
    const session = this.map[key] ?? null;
    if (session) {
      delete this.map[key];
      this.file.save();
    }
    return session;
  }

  /** The most recently used valid DSM sid of a user, for background work. */
  dsmSidFor(username: string): string | null {
    let best: StoredSession | null = null;
    for (const session of Object.values(this.map)) {
      if (session.username !== username || !session.dsmValid) continue;
      if (session.expiresAt <= Date.now()) continue;
      if (!best || session.lastSeenAt > best.lastSeenAt) best = session;
    }
    return best?.dsmSid ?? null;
  }

  /** Sessions of a user whose DSM sid was dropped but that can log in again, latest first. */
  renewable(username: string): StoredSession[] {
    const now = Date.now();
    return Object.values(this.map)
      .filter(
        (session) =>
          session.username === username &&
          !session.dsmValid &&
          !!session.credentials &&
          session.expiresAt > now,
      )
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  withDsmSid(dsmSid: string): StoredSession[] {
    return Object.values(this.map).filter((session) => session.dsmSid === dsmSid);
  }

  /** A new DSM login for the session. */
  renewDsm(session: StoredSession, dsmSid: string, isManager: boolean): void {
    Object.assign(session, { dsmSid, dsmValid: true, isManager });
    this.file.save();
  }

  /** The stored login no longer works: the user has to log in again. */
  forgetCredentials(session: StoredSession): void {
    delete session.credentials;
    this.file.save();
  }

  markDsmInvalid(dsmSid: string): void {
    let changed = false;
    for (const session of Object.values(this.map)) {
      if (session.dsmSid === dsmSid && session.dsmValid) {
        session.dsmValid = false;
        changed = true;
      }
    }
    if (changed) this.file.save();
  }

  /** Distinct valid DSM sids, e.g. to keep them alive. */
  activeDsmSids(): string[] {
    const now = Date.now();
    return [
      ...new Set(
        Object.values(this.map)
          .filter((session) => session.dsmValid && session.expiresAt > now)
          .map((session) => session.dsmSid),
      ),
    ];
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
