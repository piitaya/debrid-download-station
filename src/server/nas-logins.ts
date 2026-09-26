import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { ErrorCode } from '../shared/types.js';
import { AppError, toErrorInfo } from './errors.js';
import { log } from './logger.js';
import type { NasClient } from './nas/types.js';
import type { Sessions, StoredSession } from './sessions.js';

/** What it takes to log in to DSM again on the user's behalf. */
interface Credentials {
  password: string;
  /** "Remembered device" token: no 2FA code needed. */
  deviceId: string | null;
}

/** DSM refused the stored login: only the user can fix it (new password, trusted device…). */
const REFUSED: ReadonlySet<ErrorCode> = new Set([
  'invalid_credentials',
  'otp_required',
  'otp_invalid',
  'otp_setup_required',
  'account_disabled',
  'password_expired',
  'no_permission',
]);

/** A NAS out of reach is tried again after this delay, not at every check. */
const RETRY_MS = 60_000;

/**
 * Keeps each user's DSM session going. DSM drops its sessions after 7 days (and when it
 * restarts): the password given at login is kept, encrypted, to log in again on the user's
 * behalf, so that downloads carry on without anyone. It goes with the session (sign-out, days
 * without opening the app), or as soon as DSM refuses it.
 */
export class NasLogins {
  private readonly running = new Map<StoredSession, Promise<boolean>>();
  /** When logging in again last failed for a passing reason (NAS out of reach…). */
  private readonly lastFailure = new WeakMap<StoredSession, number>();

  constructor(
    private readonly sessions: Sessions,
    private readonly nas: () => NasClient,
    /** AES-256 key (32 bytes). */
    private readonly key: Buffer,
  ) {}

  /** Encrypts the login for storage in the session (AES-256-GCM). */
  seal(credentials: Credentials): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(credentials)), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join('.');
  }

  private open(sealed: string): Credentials | null {
    try {
      const [iv, tag, data] = sealed.split('.').map((part) => Buffer.from(part, 'base64'));
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv!);
      decipher.setAuthTag(tag!);
      return JSON.parse(Buffer.concat([decipher.update(data!), decipher.final()]).toString());
    } catch {
      // Another key (data folder copied without it…): the user logs in again.
      return null;
    }
  }

  /** The user's DSM sid as it is, for work that can be skipped (no new login). */
  currentSid(username: string): string | null {
    return this.sessions.dsmSidFor(username);
  }

  /** A working DSM sid of the user, logging in again when DSM dropped the session. */
  async sidFor(username: string): Promise<string | null> {
    const sid = this.sessions.dsmSidFor(username);
    if (sid) return sid;
    for (const session of this.sessions.renewable(username)) {
      if (await this.revive(session)) return session.dsmSid;
    }
    return null;
  }

  /** DSM refused `sid`: logs in again for the sessions that used it. */
  async expired(sid: string): Promise<void> {
    this.sessions.markDsmInvalid(sid);
    await Promise.all(this.sessions.withDsmSid(sid).map((session) => this.revive(session)));
  }

  /** Makes sure the session has a working DSM sid. False when a new login is needed. */
  revive(session: StoredSession): Promise<boolean> {
    if (session.dsmValid) return Promise.resolve(true);
    if (!session.credentials) return Promise.resolve(false);
    let run = this.running.get(session);
    if (!run) {
      run = this.login(session).finally(() => this.running.delete(session));
      this.running.set(session, run);
    }
    return run;
  }

  private async login(session: StoredSession): Promise<boolean> {
    if (Date.now() - (this.lastFailure.get(session) ?? 0) < RETRY_MS) return false;
    const credentials = session.credentials ? this.open(session.credentials) : null;
    if (!credentials) {
      this.sessions.forgetCredentials(session);
      return false;
    }
    try {
      const result = await this.nas().login({
        account: session.username,
        password: credentials.password,
        deviceId: credentials.deviceId ?? undefined,
      });
      this.sessions.renewDsm(session, result.sid, result.isManager);
      this.lastFailure.delete(session);
      log.info(`Logged in to DSM again for "${session.username}"`);
      return true;
    } catch (error) {
      const info = toErrorInfo(error);
      if (error instanceof AppError && REFUSED.has(error.code)) {
        // Trying again would only count as failed logins for DSM.
        this.sessions.forgetCredentials(session);
        log.warn(`DSM refused the stored login of "${session.username}" (${info.code})`);
      } else {
        this.lastFailure.set(session, Date.now());
        log.warn(`Could not log in to DSM again for "${session.username}"`, info);
      }
      return false;
    }
  }
}
