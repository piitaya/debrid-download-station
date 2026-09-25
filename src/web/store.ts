import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { AppSettings, ErrorCode, JobView, SessionInfo } from '../shared/types.js';
import { api, ApiError } from './api.js';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
}

/** Application state shared by every component. */
class Store extends EventTarget {
  ready = false;
  session: SessionInfo | null = null;
  /** Why the user was sent back to the login screen, if not by choice. */
  logoutReason: ErrorCode | null = null;
  settings: AppSettings | null = null;
  jobs: JobView[] = [];
  /** False while the live connection to the server is down. */
  online = true;
  toasts: Toast[] = [];

  private events: EventSource | null = null;
  private toastId = 0;
  private checkingSession: Promise<void> | null = null;

  constructor() {
    super();
    window.addEventListener('dds-unauthorized', () => this.handleUnauthorized());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.session) this.resume();
    });
  }

  private changed(): void {
    this.dispatchEvent(new Event('change'));
  }

  async init(): Promise<void> {
    try {
      this.session = await api.session();
      await this.afterLogin();
    } catch (error) {
      this.session = null;
      if (error instanceof ApiError && error.info.code === 'nas_session_expired') {
        this.logoutReason = 'nas_session_expired';
      }
    } finally {
      this.ready = true;
      this.changed();
    }
  }

  async login(username: string, password: string, otp?: string): Promise<void> {
    this.session = await api.login({ username, password, otp });
    this.logoutReason = null;
    await this.afterLogin();
    this.changed();
  }

  async logout(): Promise<void> {
    await api.logout().catch(() => undefined);
    this.reset(null);
  }

  private async afterLogin(): Promise<void> {
    this.settings = await api.settings();
    this.connectEvents();
  }

  private reset(reason: ErrorCode | null): void {
    this.events?.close();
    this.events = null;
    this.session = null;
    this.settings = null;
    this.jobs = [];
    this.logoutReason = reason;
    this.changed();
  }

  private handleUnauthorized(): void {
    if (!this.session) return;
    // Find out why (app session vs NAS session) to show the right message.
    api.session().catch((error: unknown) => {
      const code = error instanceof ApiError ? error.info.code : 'unauthorized';
      this.reset(code === 'nas_session_expired' ? code : 'unauthorized');
    });
  }

  /** Re-checks the session and the live connection, e.g. when the app comes back to foreground. */
  private resume(): void {
    this.checkingSession ??= api
      .session()
      .then((session) => {
        this.session = session;
        if (!this.events || this.events.readyState === EventSource.CLOSED) this.connectEvents();
      })
      .catch(() => undefined)
      .finally(() => {
        this.checkingSession = null;
        this.changed();
      });
  }

  private connectEvents(): void {
    this.events?.close();
    const source = new EventSource('api/events');
    this.events = source;

    source.addEventListener('open', () => {
      this.online = true;
      this.changed();
    });
    source.addEventListener('snapshot', (event) => {
      this.jobs = (JSON.parse((event as MessageEvent<string>).data) as { jobs: JobView[] }).jobs;
      this.changed();
    });
    source.addEventListener('job', (event) => {
      this.upsertJob(JSON.parse((event as MessageEvent<string>).data) as JobView);
    });
    source.addEventListener('job-removed', (event) => {
      const { id } = JSON.parse((event as MessageEvent<string>).data) as { id: string };
      this.jobs = this.jobs.filter((job) => job.id !== id);
      this.changed();
    });
    source.addEventListener('error', () => {
      if (this.events !== source) return;
      this.online = false;
      this.changed();
      // EventSource retries by itself, unless the server answered with an error (e.g. 401).
      if (source.readyState === EventSource.CLOSED) {
        this.handleUnauthorized();
        setTimeout(() => {
          if (this.events === source && this.session) this.connectEvents();
        }, 5000);
      }
    });
  }

  upsertJob(job: JobView): void {
    const index = this.jobs.findIndex((item) => item.id === job.id);
    if (index === -1) this.jobs = [job, ...this.jobs];
    else this.jobs = this.jobs.map((item) => (item.id === job.id ? job : item));
    this.changed();
  }

  removeJobs(ids: string[]): void {
    this.jobs = this.jobs.filter((job) => !ids.includes(job.id));
    this.changed();
  }

  setSettings(settings: AppSettings): void {
    this.settings = settings;
    this.changed();
  }

  toast(message: string, kind: Toast['kind'] = 'info'): void {
    const toast = { id: ++this.toastId, message, kind };
    this.toasts = [...this.toasts, toast];
    this.changed();
    setTimeout(() => this.dismissToast(toast.id), kind === 'error' ? 6000 : 3500);
  }

  dismissToast(id: number): void {
    this.toasts = this.toasts.filter((toast) => toast.id !== id);
    this.changed();
  }
}

export const store = new Store();

/** Re-renders a Lit element whenever the store changes. */
export class StoreController implements ReactiveController {
  private readonly onChange = () => this.host.requestUpdate();

  constructor(private readonly host: ReactiveControllerHost) {
    host.addController(this);
  }

  hostConnected(): void {
    store.addEventListener('change', this.onChange);
  }

  hostDisconnected(): void {
    store.removeEventListener('change', this.onChange);
  }
}
