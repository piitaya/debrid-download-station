import { randomBytes } from 'node:crypto';
import {
  CATEGORY_ICONS,
  PROVIDER_IDS,
  isProviderId,
  type AppSettings,
  type Category,
  type CategoryIcon,
  type ProviderId,
  type SettingsUpdate,
} from '../shared/types.js';
import type { Env } from './env.js';
import { HttpError } from './errors.js';
import type { JsonFile } from './storage.js';

/** Connection to Download Station (see NasConnection). */
export interface StoredNas {
  url: string;
  insecureTls: boolean;
  account: string;
  /** The DSM password and trusted-device token, encrypted. */
  credentials: string;
}

export interface StoredSettings {
  nas: StoredNas | null;
  apiKeys: Partial<Record<ProviderId, string>>;
  defaultProvider: ProviderId | null;
  categories: Category[];
  defaultCategoryId: string | null;
  createSubfolder: boolean;
  deleteFromDebrid: boolean;
}

export const defaultSettings = (): StoredSettings => ({
  nas: null,
  apiKeys: {},
  defaultProvider: null,
  categories: [],
  defaultCategoryId: null,
  createSubfolder: true,
  deleteFromDebrid: false,
});

const MAX_CATEGORIES = 30;

/** Normalizes a Download Station destination (`/video//Films/` → `video/Films`). */
export function normalizeDestination(value: string): string | null {
  const parts = value
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) return null;
  const destination = parts.join('/');
  return destination.length <= 512 ? destination : null;
}

function sanitizeCategories(input: unknown): Category[] {
  if (!Array.isArray(input)) throw new HttpError(400, 'invalid_request', 'categories');
  if (input.length > MAX_CATEGORIES) throw new HttpError(400, 'invalid_request', 'categories');

  const ids = new Set<string>();
  return input.map((raw: unknown) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 40) : '';
    const destination =
      typeof item.destination === 'string' ? normalizeDestination(item.destination) : null;
    if (!name || !destination) throw new HttpError(400, 'invalid_request', 'category');

    let id = typeof item.id === 'string' ? item.id.trim().slice(0, 64) : '';
    if (!id || ids.has(id)) id = randomBytes(6).toString('hex');
    ids.add(id);

    const icon: CategoryIcon = CATEGORY_ICONS.includes(item.icon as CategoryIcon)
      ? (item.icon as CategoryIcon)
      : 'folder';
    return { id, name, icon, destination };
  });
}

export class Settings {
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly file: JsonFile<StoredSettings>,
    private readonly env: Env,
  ) {
    this.file.data = { ...defaultSettings(), ...this.file.data };
  }

  private get data(): StoredSettings {
    return this.file.data;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get nas(): StoredNas | null {
    return this.data.nas;
  }

  setNas(nas: StoredNas): void {
    this.file.data = { ...this.data, nas };
    this.file.save();
  }

  apiKey(id: ProviderId): string | null {
    return this.env.providerKeys[id] ?? this.data.apiKeys[id] ?? null;
  }

  configuredProviders(): ProviderId[] {
    return PROVIDER_IDS.filter((id) => this.apiKey(id) !== null);
  }

  defaultProvider(): ProviderId | null {
    const configured = this.configuredProviders();
    const stored = this.data.defaultProvider;
    return stored && configured.includes(stored) ? stored : (configured[0] ?? null);
  }

  category(id: string): Category | null {
    return this.data.categories.find((category) => category.id === id) ?? null;
  }

  get createSubfolder(): boolean {
    return this.data.createSubfolder;
  }

  get deleteFromDebrid(): boolean {
    return this.data.deleteFromDebrid;
  }

  toPublic(): AppSettings {
    const categories = this.data.categories;
    const defaultCategoryId = categories.some((c) => c.id === this.data.defaultCategoryId)
      ? this.data.defaultCategoryId
      : (categories[0]?.id ?? null);
    const nas = this.data.nas;
    return {
      nas: nas ? { url: nas.url, account: nas.account, insecureTls: nas.insecureTls } : null,
      providers: PROVIDER_IDS.map((id) => ({
        id,
        configured: this.apiKey(id) !== null,
        fromEnv: this.env.providerKeys[id] !== undefined,
      })),
      defaultProvider: this.defaultProvider(),
      categories,
      defaultCategoryId,
      createSubfolder: this.data.createSubfolder,
      deleteFromDebrid: this.data.deleteFromDebrid,
    };
  }

  update(patch: SettingsUpdate): AppSettings {
    const next: StoredSettings = { ...this.data, apiKeys: { ...this.data.apiKeys } };

    if (patch.categories !== undefined) next.categories = sanitizeCategories(patch.categories);
    if (patch.defaultCategoryId !== undefined) {
      next.defaultCategoryId =
        typeof patch.defaultCategoryId === 'string' ? patch.defaultCategoryId : null;
    }
    if (patch.defaultProvider !== undefined) {
      if (patch.defaultProvider !== null && !isProviderId(patch.defaultProvider)) {
        throw new HttpError(400, 'invalid_request', 'defaultProvider');
      }
      next.defaultProvider = patch.defaultProvider;
    }
    if (typeof patch.createSubfolder === 'boolean') next.createSubfolder = patch.createSubfolder;
    if (typeof patch.deleteFromDebrid === 'boolean') next.deleteFromDebrid = patch.deleteFromDebrid;

    if (patch.apiKeys) {
      for (const [id, value] of Object.entries(patch.apiKeys)) {
        if (!isProviderId(id)) throw new HttpError(400, 'invalid_request', 'apiKeys');
        if (value === null || value === '') delete next.apiKeys[id];
        else if (typeof value === 'string') next.apiKeys[id] = value.trim();
      }
    }

    this.file.data = next;
    this.file.save();
    for (const listener of this.listeners) listener();
    return this.toPublic();
  }
}
