import type { ErrorCode, ProviderAccount } from '../../shared/types.js';
import { AppError } from '../errors.js';
import { httpError, Pacer, requestJson } from './http.js';
import type {
  AddedTorrent,
  DebridContent,
  DebridFile,
  DebridProvider,
  DebridStatus,
} from './types.js';

/*
 * TorBox API v1 (api.torbox.app). Envelope: `{ success, error, detail, data }`, and some
 * failures come back with HTTP 200 and `success: false`.
 */

interface Envelope<T> {
  success?: boolean;
  error?: string | null;
  detail?: string;
  data?: T;
}

interface TbTorrent {
  id: number;
  hash?: string;
  name?: string;
  size?: number;
  download_state?: string;
  progress?: number;
  download_speed?: number;
  seeds?: number;
  download_finished?: boolean;
  download_present?: boolean;
  files?: { id: number; name: string; short_name?: string; size: number }[] | null;
}

const ERRORS: Record<string, ErrorCode> = {
  NO_AUTH: 'provider_auth',
  BAD_TOKEN: 'provider_auth',
  AUTH_ERROR: 'provider_auth',
  BOZO_TORRENT: 'torrent_invalid',
  DOWNLOAD_TOO_LARGE: 'torrent_too_big',
  ACTIVE_LIMIT: 'provider_rate_limited',
  MONTHLY_LIMIT: 'provider_rate_limited',
  COOLDOWN_LIMIT: 'provider_rate_limited',
  RATE_LIMIT: 'provider_rate_limited',
  PLAN_RESTRICTED_FEATURE: 'provider_premium',
  ITEM_NOT_FOUND: 'not_found',
  DOWNLOAD_SERVER_ERROR: 'provider_unreachable',
  NO_SERVERS_AVAILABLE_ERROR: 'provider_unreachable',
  DATABASE_ERROR: 'provider_unreachable',
  UNKNOWN_ERROR: 'provider_unreachable',
};

/** Queued torrents (no free slot) have no torrent id yet: `queued:<queued_id>:<hash>`. */
const QUEUED = /^queued:(\d+):([0-9a-f]*)$/;

export class TorBox implements DebridProvider {
  readonly id = 'torbox' as const;
  /** `requestdl` allows about 100 calls per 5 minutes; a 429 locks the account for 5 minutes. */
  private readonly pacer = new Pacer(3100);

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: FormData | Record<string, unknown>,
  ): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}` };
    let payload: FormData | string | undefined;
    if (body instanceof FormData) {
      payload = body;
    } else if (body) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const { status, data } = await requestJson<Envelope<T>>(`${this.baseUrl}/v1/api/${path}`, {
      method,
      headers,
      body: payload,
    });
    if (data?.success) return data.data as T;
    const message = [data?.error, data?.detail].filter(Boolean).join(': ') || undefined;
    if (data?.error && ERRORS[data.error]) throw new AppError(ERRORS[data.error]!, message);
    throw httpError(status, message);
  }

  async account(): Promise<ProviderAccount> {
    const user = await this.call<{
      email: string;
      plan?: number;
      premium_expires_at?: string | null;
    }>('GET', 'user/me');
    const premium = (user.plan ?? 0) > 0;
    const until = user.premium_expires_at ? Date.parse(user.premium_expires_at) : NaN;
    return {
      username: user.email,
      premium,
      premiumUntil: premium && !Number.isNaN(until) ? until : null,
    };
  }

  private async create(form: FormData, hash: string | null): Promise<AddedTorrent> {
    form.set('seed', '3'); // Do not seed.
    form.set('allow_zip', 'false');
    const data = await this.call<{ torrent_id?: number; queued_id?: number }>(
      'POST',
      'torrents/createtorrent',
      form,
    );
    if (data.torrent_id !== undefined) return { id: String(data.torrent_id), name: null };
    if (data.queued_id !== undefined)
      return { id: `queued:${data.queued_id}:${hash ?? ''}`, name: null };
    throw new AppError('provider_error', 'Missing torrent id');
  }

  addMagnet(magnet: string, hash: string | null): Promise<AddedTorrent> {
    const form = new FormData();
    form.set('magnet', magnet);
    return this.create(form, hash);
  }

  addTorrent(data: Uint8Array, fileName: string, hash: string | null): Promise<AddedTorrent> {
    const form = new FormData();
    form.set('file', new Blob([data], { type: 'application/x-bittorrent' }), fileName);
    return this.create(form, hash);
  }

  private torrent(id: string): Promise<TbTorrent> {
    return this.call<TbTorrent>(
      'GET',
      `torrents/mylist?id=${encodeURIComponent(id)}&bypass_cache=true`,
    );
  }

  async status(id: string): Promise<DebridStatus> {
    const queued = QUEUED.exec(id);
    let torrent: TbTorrent | undefined;
    let newId: string | undefined;
    if (queued) {
      // Waits for the torrent to leave the queue, then finds it by hash.
      const list = await this.call<TbTorrent[]>('GET', 'torrents/mylist?bypass_cache=true');
      torrent = queued[2] ? list.find((item) => item.hash?.toLowerCase() === queued[2]) : undefined;
      if (!torrent) {
        return {
          state: 'queued',
          name: null,
          size: null,
          progress: null,
          speed: null,
          seeders: null,
          detail: 'queued',
        };
      }
      newId = String(torrent.id);
    } else {
      torrent = await this.torrent(id);
    }

    const state = (torrent.download_state ?? '').toLowerCase();
    const base = {
      name: torrent.name ?? null,
      size: torrent.size && torrent.size > 0 ? torrent.size : null,
      detail: torrent.download_state ?? null,
      ...(newId ? { id: newId } : {}),
    };

    // `download_finished` turns true a few seconds before the files are available.
    if (torrent.download_present) {
      return { ...base, state: 'ready', progress: 1, speed: null, seeders: null };
    }
    if (/error|fail|expired|missing/.test(state)) {
      return {
        ...base,
        state: 'error',
        progress: null,
        speed: null,
        seeders: null,
        error: new AppError('torrent_failed', torrent.download_state),
      };
    }
    if (
      !state ||
      state.startsWith('metadl') ||
      state.startsWith('checking') ||
      state === 'queued'
    ) {
      return {
        ...base,
        state: 'queued',
        progress: null,
        speed: null,
        seeders: null,
        detail: 'queued',
      };
    }
    if (state.includes('downloading') || state.startsWith('stalled')) {
      return {
        ...base,
        state: 'downloading',
        progress: torrent.progress ?? null,
        speed: torrent.download_speed ?? null,
        seeders: torrent.seeds ?? null,
      };
    }
    return { ...base, state: 'processing', progress: null, speed: null, seeders: null };
  }

  async files(id: string): Promise<DebridContent> {
    const torrent = await this.torrent(id);
    const files = torrent.files ?? [];
    const name = torrent.name ?? id;
    // In multi-file torrents, names start with the torrent's root folder.
    const roots = new Set(
      files.map((file) => (file.name.includes('/') ? file.name.split('/')[0] : null)),
    );
    const root = roots.size === 1 ? [...roots][0] : null;
    return {
      name: root ?? name,
      multiFile: files.length > 1 || root !== null,
      files: files.map((file) => ({
        path: root ? file.name.slice(root.length + 1) : file.name,
        size: file.size,
        ref: String(file.id),
      })),
    };
  }

  async unlock(id: string, file: DebridFile): Promise<string> {
    const query = new URLSearchParams({
      token: this.apiKey,
      torrent_id: id,
      file_id: file.ref,
      zip_link: 'false',
      append_name: 'true',
    });
    return this.pacer.run(() => this.call<string>('GET', `torrents/requestdl?${query}`));
  }

  async delete(id: string): Promise<void> {
    const queued = QUEUED.exec(id);
    if (queued) {
      await this.call('POST', 'queued/controlqueued', {
        queued_id: Number(queued[1]),
        operation: 'delete',
      });
      return;
    }
    await this.call('POST', 'torrents/controltorrent', {
      torrent_id: Number(id),
      operation: 'delete',
    });
  }
}
