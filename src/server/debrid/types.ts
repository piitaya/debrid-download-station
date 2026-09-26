import type { ProviderAccount, ProviderId } from '../../shared/types.js';
import type { AppError } from '../errors.js';

export interface AddedTorrent {
  id: string;
  name: string | null;
}

export interface DebridStatus {
  state: 'queued' | 'downloading' | 'processing' | 'ready' | 'error';
  name: string | null;
  size: number | null;
  /** Between 0 and 1. */
  progress: number | null;
  /** Bytes per second. */
  speed: number | null;
  seeders: number | null;
  /** Raw status reported by the service. */
  detail: string | null;
  error?: AppError;
  /** The service gave the torrent a new id (e.g. once out of a queue). */
  id?: string;
}

export interface DebridFile {
  /** Path inside the torrent, relative to its root folder, with `/` separators. */
  path: string;
  size: number;
  /** Provider reference used to get the direct link (hoster link, file id…). */
  ref: string;
}

export interface DebridContent {
  /** Torrent name (root folder name for multi-file torrents). */
  name: string;
  /** Whether the torrent has a root folder (multi-file torrent). */
  multiFile: boolean;
  files: DebridFile[];
}

export interface DebridProvider {
  readonly id: ProviderId;
  account(): Promise<ProviderAccount>;
  /** `hash`: info-hash of the torrent, when known. */
  addMagnet(magnet: string, hash: string | null): Promise<AddedTorrent>;
  addTorrent(data: Uint8Array, fileName: string, hash: string | null): Promise<AddedTorrent>;
  status(id: string): Promise<DebridStatus>;
  /** Files of a ready torrent. */
  files(id: string): Promise<DebridContent>;
  /** Direct HTTPS download URL of a file. */
  unlock(id: string, file: DebridFile): Promise<string>;
  delete(id: string): Promise<void>;
}
