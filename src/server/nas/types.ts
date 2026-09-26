import type { FolderEntry } from '../../shared/types.js';
import { AppError } from '../errors.js';

export interface DsTask {
  id: string;
  /** Download Station status: waiting, downloading, paused, finishing, finished, error… */
  status: string;
  size: number;
  downloaded: number;
  speed: number;
  /** Error detail reported by Download Station, when status is `error`. */
  error: string | null;
  uri: string | null;
  /** File name chosen by Download Station. */
  title: string | null;
}

export interface LoginParams {
  account: string;
  password: string;
  otpCode?: string;
  /** Device token from a previous 2FA login ("remember this device"). */
  deviceId?: string;
}

export interface LoginResult {
  sid: string;
  /** Device token returned when logging in with a 2FA code. */
  deviceId: string | null;
  /** Whether the user manages Download Station (DSM administrators). */
  isManager: boolean;
}

/** Thrown when DSM no longer accepts a session id. */
export class NasSessionError extends AppError {
  constructor(readonly sid: string) {
    super('nas_session_expired');
    this.name = 'NasSessionError';
  }
}

/** What the rest of the app needs from the NAS (Synology DSM). */
export interface NasClient {
  login(params: LoginParams): Promise<LoginResult>;
  logout(sid: string): Promise<void>;
  /** Throws NasSessionError when the session is no longer valid. */
  checkSession(sid: string): Promise<void>;

  /** Creates folders (Download Station paths such as `video/Films/Show`) and their parents. */
  createFolders(sid: string, paths: string[]): Promise<void>;
  listShares(sid: string): Promise<FolderEntry[]>;
  listFolders(sid: string, path: string): Promise<FolderEntry[]>;
  /** Renames a file or folder (Download Station path) to `name`. */
  rename(sid: string, path: string, name: string): Promise<void>;

  /** Creates one task per URL. Returns the task ids, in the same order (null when unknown). */
  createDownloadTasks(sid: string, urls: string[], destination: string): Promise<(string | null)[]>;
  getTasks(sid: string, ids: string[]): Promise<DsTask[]>;
  listTasks(sid: string): Promise<DsTask[]>;
  deleteTasks(sid: string, ids: string[]): Promise<void>;
}
