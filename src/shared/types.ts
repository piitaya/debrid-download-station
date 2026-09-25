/** API contract shared by the server and the web app. */

export const PROVIDER_IDS = ['alldebrid', 'realdebrid', 'torbox'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const PROVIDERS: Record<ProviderId, { name: string; apiKeyUrl: string }> = {
  alldebrid: { name: 'AllDebrid', apiKeyUrl: 'https://alldebrid.com/apikeys/' },
  realdebrid: { name: 'Real-Debrid', apiKeyUrl: 'https://real-debrid.com/apitoken' },
  torbox: { name: 'TorBox', apiKeyUrl: 'https://torbox.app/settings' },
};

export const isProviderId = (value: unknown): value is ProviderId =>
  typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value);

export const CATEGORY_ICONS = [
  'movie',
  'tv',
  'anime',
  'kids',
  'documentary',
  'music',
  'book',
  'game',
  'app',
  'sport',
  'star',
  'download',
  'folder',
] as const;
export type CategoryIcon = (typeof CATEGORY_ICONS)[number];

export interface Category {
  id: string;
  name: string;
  icon: CategoryIcon;
  /** Download Station destination: shared folder + sub path, without leading slash (`video/Films`). */
  destination: string;
}

export interface ProviderState {
  id: ProviderId;
  configured: boolean;
  /** The API key comes from an environment variable and cannot be changed from the UI. */
  fromEnv: boolean;
}

export interface AppSettings {
  providers: ProviderState[];
  defaultProvider: ProviderId | null;
  categories: Category[];
  defaultCategoryId: string | null;
  /** Put multi-file torrents in their own folder (like a BitTorrent client does). */
  createSubfolder: boolean;
  /** Remove the torrent from the debrid account once Download Station has finished. */
  deleteFromDebrid: boolean;
}

export interface SettingsUpdate {
  defaultProvider?: ProviderId | null;
  categories?: Category[];
  defaultCategoryId?: string | null;
  createSubfolder?: boolean;
  deleteFromDebrid?: boolean;
  /** New API keys; `null` removes the stored key. */
  apiKeys?: Partial<Record<ProviderId, string | null>>;
}

export interface SessionInfo {
  user: { username: string; isAdmin: boolean };
  nasUrl: string;
  version: string;
}

export interface ProviderAccount {
  username: string;
  premium: boolean;
  /** Epoch milliseconds, when known. */
  premiumUntil: number | null;
}

export interface FolderEntry {
  name: string;
  /** Download Station path format (`video/Films`). */
  path: string;
}

export interface FolderListing {
  /** Listed folder, or null for the list of shared folders. */
  path: string | null;
  folders: FolderEntry[];
}

export type ErrorCode =
  // Session / login
  | 'unauthorized'
  | 'nas_session_expired'
  | 'invalid_credentials'
  | 'otp_required'
  | 'otp_invalid'
  | 'otp_setup_required'
  | 'not_allowed'
  | 'no_permission'
  | 'account_disabled'
  | 'password_expired'
  | 'ip_blocked'
  | 'too_many_attempts'
  | 'nas_unreachable'
  | 'nas_not_configured'
  | 'nas_error'
  // Generic
  | 'forbidden'
  | 'invalid_request'
  | 'not_found'
  | 'internal'
  // Debrid
  | 'provider_not_configured'
  | 'provider_auth'
  | 'provider_premium'
  | 'provider_rate_limited'
  | 'provider_unreachable'
  | 'provider_error'
  | 'magnet_invalid'
  | 'torrent_invalid'
  | 'torrent_dead'
  | 'torrent_too_big'
  | 'torrent_failed'
  // Download Station
  | 'category_missing'
  | 'destination_denied'
  | 'destination_missing'
  | 'folder_failed'
  | 'download_failed'
  | 'task_removed';

export interface ErrorInfo {
  code: ErrorCode;
  /** Raw message from the NAS or the debrid service, for details. */
  message?: string;
}

export interface ApiErrorBody {
  error: ErrorInfo;
}

export type JobStatus =
  /** The debrid service is fetching the torrent. */
  | 'debrid'
  /** Links are being unlocked and sent to Download Station. */
  | 'sending'
  /** The NAS session expired: waits for the owner to log in again. */
  | 'waiting_login'
  /** Download Station is downloading the files. */
  | 'downloading'
  | 'completed'
  | 'error'
  | 'cancelled';

export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = [
  'debrid',
  'sending',
  'waiting_login',
  'downloading',
];

export type JobFileStatus =
  'pending' | 'queued' | 'downloading' | 'completed' | 'error' | 'removed';

export interface JobFileView {
  path: string;
  size: number;
  status: JobFileStatus;
  progress: number | null;
}

export interface JobView {
  id: string;
  name: string;
  provider: ProviderId;
  categoryName: string | null;
  categoryIcon: CategoryIcon | null;
  destination: string;
  status: JobStatus;
  size: number | null;
  /** Progress of the current phase, between 0 and 1. */
  progress: number | null;
  /** Bytes per second. */
  speed: number | null;
  seeders: number | null;
  /** Raw status label from the debrid service (queued, downloading…). */
  detail: string | null;
  error: ErrorInfo | null;
  files: JobFileView[];
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
}

export type AddJobResult =
  { ok: true; job: JobView } | { ok: false; input: string; error: ErrorInfo };

export interface AddJobsResponse {
  results: AddJobResult[];
}

export interface AddJobsRequest {
  magnets: string[];
  provider: ProviderId;
  categoryId: string;
}

/** Server-sent events emitted on `/api/events`. */
export interface ServerEvents {
  snapshot: { jobs: JobView[] };
  job: JobView;
  'job-removed': { id: string };
}
