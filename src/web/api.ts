import type {
  AddJobsResponse,
  AppSettings,
  ErrorInfo,
  FolderEntry,
  FolderListing,
  JobView,
  ProviderAccount,
  ProviderId,
  SessionInfo,
  SettingsUpdate,
} from '../shared/types.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly info: ErrorInfo,
  ) {
    super(info.message ?? info.code);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

// Relative URLs so the app also works behind a reverse proxy sub-path.
async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'dds' };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(`api/${path}`, {
      method,
      headers,
      body: payload,
      credentials: 'same-origin',
    });
  } catch (error) {
    throw new ApiError(0, { code: 'internal', message: (error as Error).message });
  }

  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => null)) as { error?: ErrorInfo } | null;
  if (!response.ok) {
    const info = data?.error ?? { code: 'internal', message: `HTTP ${response.status}` };
    const error = new ApiError(response.status, info);
    if (response.status === 401) window.dispatchEvent(new CustomEvent('dds-unauthorized'));
    throw error;
  }
  return data as T;
}

export const api = {
  session: () => request<SessionInfo>('GET', 'session'),
  login: (body: { username: string; password: string; otp?: string }) =>
    request<SessionInfo>('POST', 'login', body),
  logout: () => request<void>('POST', 'logout'),

  settings: () => request<AppSettings>('GET', 'settings'),
  updateSettings: (patch: SettingsUpdate) => request<AppSettings>('PUT', 'settings', patch),
  testProvider: (id: ProviderId, apiKey?: string) =>
    request<ProviderAccount>('POST', `providers/${id}/test`, { apiKey }),

  folders: (path?: string) =>
    request<FolderListing>('GET', path ? `folders?path=${encodeURIComponent(path)}` : 'folders'),
  createFolder: (path: string, name: string) =>
    request<FolderEntry>('POST', 'folders', { path, name }),

  jobs: () => request<{ jobs: JobView[] }>('GET', 'jobs'),
  addJobs: (form: FormData) => request<AddJobsResponse>('POST', 'jobs', form),
  retryJob: (id: string) => request<JobView>('POST', `jobs/${encodeURIComponent(id)}/retry`),
  deleteJob: (id: string, cancel: boolean) =>
    request<void>('DELETE', `jobs/${encodeURIComponent(id)}${cancel ? '?cancel=1' : ''}`),
  clearJobs: () => request<void>('POST', 'jobs/clear'),
};
