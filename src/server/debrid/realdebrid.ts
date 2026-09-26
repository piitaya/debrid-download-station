import type { ErrorCode, ProviderAccount } from '../../shared/types.js';
import { AppError } from '../errors.js';
import { log } from '../logger.js';
import { httpError, Pacer, requestJson } from './http.js';
import type {
  AddedTorrent,
  DebridContent,
  DebridFile,
  DebridProvider,
  DebridStatus,
} from './types.js';

/*
 * Real-Debrid REST API 1.0 (api.real-debrid.com). Errors: 4xx/5xx with
 * `{ error, error_code }`.
 */

interface RdError {
  error?: string;
  error_code?: number;
}

interface RdTorrent {
  id: string;
  filename?: string;
  original_filename?: string;
  hash?: string;
  bytes?: number;
  original_bytes?: number;
  progress?: number;
  status: string;
  files?: { id: number; path: string; bytes: number; selected: number }[];
  links?: string[];
  speed?: number;
  seeders?: number;
}

const ERROR_CODES: Record<number, ErrorCode> = {
  [-1]: 'provider_unreachable',
  5: 'provider_rate_limited',
  7: 'not_found',
  8: 'provider_auth',
  9: 'provider_auth',
  10: 'provider_auth',
  11: 'provider_auth',
  12: 'provider_auth',
  13: 'provider_auth',
  14: 'provider_auth',
  15: 'provider_auth',
  17: 'provider_unreachable',
  19: 'provider_unreachable',
  20: 'provider_premium',
  21: 'provider_rate_limited',
  23: 'provider_rate_limited',
  24: 'torrent_dead',
  25: 'provider_unreachable',
  26: 'torrent_too_big',
  27: 'torrent_invalid',
  28: 'torrent_failed',
  29: 'torrent_too_big',
  30: 'torrent_invalid',
  34: 'provider_rate_limited',
  35: 'torrent_failed',
  36: 'provider_rate_limited',
};

/** Selecting other file types makes Real-Debrid pack everything into a single RAR archive. */
const MEDIA_FILE = /\.(mkv|mp4|avi|ts|m2ts|mov|webm|wmv|flv|mpg|mpeg|m4v|mp3|flac|m4a)$/i;

const IN_PROGRESS: Record<string, DebridStatus['state']> = {
  magnet_conversion: 'queued',
  waiting_files_selection: 'queued',
  queued: 'queued',
  downloading: 'downloading',
  compressing: 'processing',
  uploading: 'processing',
};

const FAILED: Record<string, ErrorCode> = {
  magnet_error: 'torrent_dead',
  dead: 'torrent_dead',
  virus: 'torrent_failed',
  error: 'torrent_failed',
};

export class RealDebrid implements DebridProvider {
  readonly id = 'realdebrid' as const;
  /** Keep link generation gentle (250 requests/minute for the whole account). */
  private readonly pacer = new Pacer(1000);

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  private async call<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: URLSearchParams | Uint8Array,
  ): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}` };
    if (body instanceof Uint8Array) headers['Content-Type'] = 'application/x-bittorrent';
    const { status, data } = await requestJson<T & RdError>(`${this.baseUrl}/rest/1.0/${path}`, {
      method,
      headers,
      body: body as RequestInit['body'],
    });
    if (status >= 200 && status < 300) return data as T;
    const code = data?.error_code;
    const message = data?.error ? `${data.error} (${code})` : undefined;
    if (code !== undefined && ERROR_CODES[code]) throw new AppError(ERROR_CODES[code]!, message);
    if (status === 509) throw new AppError('provider_rate_limited', message);
    throw httpError(status, message);
  }

  async account(): Promise<ProviderAccount> {
    const user = await this.call<{ username: string; type: string; expiration?: string }>(
      'GET',
      'user',
    );
    const premium = user.type === 'premium';
    const until = user.expiration ? Date.parse(user.expiration) : NaN;
    return {
      username: user.username,
      premium,
      premiumUntil: premium && !Number.isNaN(until) ? until : null,
    };
  }

  /**
   * Adding a torrent the account already has creates a copy stuck at 0%: reuse the existing
   * one instead.
   */
  private async findExisting(hash: string | null): Promise<string | null> {
    if (!hash || hash.length !== 40) return null;
    try {
      const torrents = await this.call<RdTorrent[] | null>('GET', 'torrents?limit=500');
      const match = (torrents ?? []).find(
        (torrent) => torrent.hash?.toLowerCase() === hash && !FAILED[torrent.status],
      );
      return match?.id ?? null;
    } catch (error) {
      log.debug('Real-Debrid: could not list torrents', error);
      return null;
    }
  }

  async addMagnet(magnet: string, hash: string | null): Promise<AddedTorrent> {
    const existing = await this.findExisting(hash);
    if (existing) return { id: existing, name: null };
    try {
      const { id } = await this.call<{ id: string }>(
        'POST',
        'torrents/addMagnet',
        new URLSearchParams({ magnet }),
      );
      return { id, name: null };
    } catch (error) {
      // 1 missing / 2 bad parameter value.
      if (error instanceof AppError && error.code === 'provider_error') {
        throw new AppError('magnet_invalid', error.message);
      }
      throw error;
    }
  }

  async addTorrent(
    data: Uint8Array,
    _fileName: string,
    hash: string | null,
  ): Promise<AddedTorrent> {
    const existing = await this.findExisting(hash);
    if (existing) return { id: existing, name: null };
    const { id } = await this.call<{ id: string }>('PUT', 'torrents/addTorrent', data);
    return { id, name: null };
  }

  private info(id: string): Promise<RdTorrent> {
    return this.call<RdTorrent>('GET', `torrents/info/${encodeURIComponent(id)}`);
  }

  /** Picks the audio/video files when there are some (see MEDIA_FILE), everything otherwise. */
  private async selectFiles(torrent: RdTorrent): Promise<void> {
    const files = torrent.files ?? [];
    const media = files.filter((file) => MEDIA_FILE.test(file.path));
    const selection = media.length ? media.map((file) => file.id).join(',') : 'all';
    await this.call(
      'POST',
      `torrents/selectFiles/${encodeURIComponent(torrent.id)}`,
      new URLSearchParams({ files: selection }),
    );
  }

  async status(id: string): Promise<DebridStatus> {
    const torrent = await this.info(id);
    // During magnet conversion the name is the literal "Magnet".
    const converting = torrent.status === 'magnet_conversion';
    const base = {
      name: converting ? null : (torrent.original_filename ?? torrent.filename ?? null),
      size: torrent.bytes || null,
      detail: torrent.status,
      seeders: torrent.seeders ?? null,
    };

    if (torrent.status === 'downloaded' && torrent.links?.length) {
      return { ...base, state: 'ready', progress: 1, speed: null, seeders: null };
    }
    const failure = FAILED[torrent.status];
    if (failure) {
      return {
        ...base,
        state: 'error',
        progress: null,
        speed: null,
        error: new AppError(failure, torrent.status),
      };
    }
    if (torrent.status === 'waiting_files_selection') {
      await this.selectFiles(torrent);
      return { ...base, state: 'queued', progress: null, speed: null, detail: 'queued' };
    }

    const state = IN_PROGRESS[torrent.status] ?? 'processing';
    return {
      ...base,
      state,
      // The progress restarts from 0 while uploading: only show it while downloading.
      progress: state === 'downloading' ? (torrent.progress ?? 0) / 100 : null,
      speed: state === 'downloading' ? (torrent.speed ?? null) : null,
      detail: state === 'queued' ? 'queued' : torrent.status,
    };
  }

  async files(id: string): Promise<DebridContent> {
    const torrent = await this.info(id);
    const all = torrent.files ?? [];
    const selected = all.filter((file) => file.selected === 1).sort((a, b) => a.id - b.id);
    const links = torrent.links ?? [];
    const name = torrent.original_filename ?? torrent.filename ?? id;
    const multiFile = all.length > 1;

    // links[i] is the i-th selected file.
    if (links.length === selected.length) {
      return {
        name,
        multiFile,
        files: selected.map((file, index) => ({
          path: file.path.replace(/^\/+/, ''),
          size: file.bytes,
          ref: links[index]!,
        })),
      };
    }

    // Real-Debrid packed the files into archive(s): ask each link for its file name.
    const files: DebridFile[] = [];
    for (const link of links) {
      const unrestricted = await this.unrestrict(link);
      files.push({ path: unrestricted.filename, size: unrestricted.filesize ?? 0, ref: link });
    }
    return { name, multiFile: files.length > 1, files };
  }

  private unrestrict(link: string) {
    return this.pacer.run(() =>
      this.call<{ download: string; filename: string; filesize?: number }>(
        'POST',
        'unrestrict/link',
        new URLSearchParams({ link }),
      ),
    );
  }

  async unlock(_id: string, file: DebridFile): Promise<string> {
    return (await this.unrestrict(file.ref)).download;
  }

  async delete(id: string): Promise<void> {
    await this.call('DELETE', `torrents/delete/${encodeURIComponent(id)}`);
  }
}
