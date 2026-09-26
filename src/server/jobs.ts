import { randomUUID } from 'node:crypto';
import {
  ACTIVE_JOB_STATUSES,
  type CategoryIcon,
  type ErrorInfo,
  type JobFileStatus,
  type JobStatus,
  type JobView,
  type ProviderId,
} from '../shared/types.js';
import type { DebridProvider } from './debrid/types.js';
import { AppError, toErrorInfo } from './errors.js';
import type { EventHub } from './events.js';
import { log } from './logger.js';
import type { DsTask, NasClient } from './nas/types.js';
import { NasSessionError } from './nas/types.js';
import { basename, dirname, isPlainName, joinPath, planDownload } from './paths.js';
import type { Sessions } from './sessions.js';
import type { JsonFile } from './storage.js';

export interface JobFile {
  /** Relative to the category folder. */
  path: string;
  size: number;
  ref: string;
  /** Direct link handed to Download Station. */
  url: string | null;
  taskId: string | null;
  status: JobFileStatus;
  downloaded: number;
  speed: number;
  error: string | null;
}

export interface Job {
  id: string;
  owner: string;
  provider: ProviderId;
  debridId: string;
  name: string;
  categoryName: string;
  categoryIcon: CategoryIcon;
  /** Category folder (Download Station path). */
  destination: string;
  /** Folder created for this torrent inside the category folder, if any. */
  folder: string | null;
  status: JobStatus;
  /** Step to resume from when retrying a failed job. */
  phase: 'debrid' | 'sending' | 'downloading';
  size: number | null;
  progress: number | null;
  speed: number | null;
  seeders: number | null;
  detail: string | null;
  error: ErrorInfo | null;
  files: JobFile[];
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  nextCheckAt: number;
  /** Consecutive transient failures. */
  failures: number;
}

export interface JobsFile {
  jobs: Job[];
}

export interface NewJob {
  owner: string;
  provider: ProviderId;
  debridId: string;
  name: string;
  category: { name: string; icon: CategoryIcon; destination: string };
}

export interface JobDeps {
  file: JsonFile<JobsFile>;
  nas: NasClient;
  sessions: Sessions;
  events: EventHub;
  provider: (id: ProviderId) => DebridProvider;
  options: () => { createSubfolder: boolean; deleteFromDebrid: boolean };
}

const TICK_MS = 1000;
const MAX_FAILURES = 30;
const MAX_JOBS_PER_USER = 300;
const FINISHED_RETENTION_MS = 30 * 24 * 3600 * 1000;

/** Errors worth retrying later (network hiccups, rate limits, busy services). */
const TRANSIENT_CODES = new Set([
  'provider_unreachable',
  'provider_rate_limited',
  'nas_unreachable',
]);

const isActive = (job: Job) => ACTIVE_JOB_STATUSES.includes(job.status);

function fileStatusFromTask(task: DsTask): JobFileStatus {
  switch (task.status) {
    case 'finished':
    case 'seeding':
      return 'completed';
    case 'error':
      return 'error';
    case 'waiting':
    case 'filehosting_waiting':
      return 'queued';
    default:
      return 'downloading';
  }
}

export class JobManager {
  private timer: NodeJS.Timeout | null = null;
  private readonly busy = new Set<string>();

  constructor(private readonly deps: JobDeps) {
    this.prune();
  }

  private get jobs(): Job[] {
    return this.deps.file.data.jobs;
  }

  start(): void {
    this.timer ??= setInterval(() => void this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  list(owner: string): Job[] {
    return this.jobs.filter((job) => job.owner === owner);
  }

  get(owner: string, id: string): Job {
    const job = this.jobs.find((item) => item.id === id && item.owner === owner);
    if (!job) throw new AppError('not_found');
    return job;
  }

  create(input: NewJob): Job {
    const now = Date.now();
    const job: Job = {
      id: randomUUID(),
      owner: input.owner,
      provider: input.provider,
      debridId: input.debridId,
      name: input.name,
      categoryName: input.category.name,
      categoryIcon: input.category.icon,
      destination: input.category.destination,
      folder: null,
      status: 'debrid',
      phase: 'debrid',
      size: null,
      progress: null,
      speed: null,
      seeders: null,
      detail: null,
      error: null,
      files: [],
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      nextCheckAt: now,
      failures: 0,
    };
    this.jobs.unshift(job);
    this.prune();
    this.changed(job);
    return job;
  }

  retry(owner: string, id: string): Job {
    const job = this.get(owner, id);
    if (job.status !== 'error') return job;
    job.error = null;
    job.failures = 0;
    job.finishedAt = null;
    if (job.phase === 'downloading') {
      // Failed files get a fresh link: debrid links may have expired.
      const failed = job.files.filter((file) => file.status === 'error');
      const sid = this.deps.sessions.dsmSidFor(owner);
      const ids = failed.map((file) => file.taskId).filter((taskId): taskId is string => !!taskId);
      if (sid && ids.length) {
        this.deps.nas.deleteTasks(sid, ids).catch(() => undefined);
      }
      for (const file of failed) {
        Object.assign(file, {
          url: null,
          taskId: null,
          status: 'pending',
          downloaded: 0,
          speed: 0,
          error: null,
        });
      }
      job.phase = 'sending';
    }
    job.status = job.phase;
    job.nextCheckAt = Date.now();
    this.changed(job);
    return job;
  }

  /** Removes a job. With `cancel`, also stops it on the debrid service and Download Station. */
  async remove(owner: string, id: string, cancel: boolean): Promise<void> {
    const job = this.get(owner, id);
    this.deps.file.data.jobs = this.jobs.filter((item) => item !== job);
    this.deps.file.save();
    this.deps.events.emit(owner, 'job-removed', { id });

    if (!cancel) return;
    const sid = this.deps.sessions.dsmSidFor(owner);
    const running = job.files
      .filter((file) => file.taskId && file.status !== 'completed')
      .map((file) => file.taskId!);
    if (sid && running.length) {
      await this.deps.nas
        .deleteTasks(sid, running)
        .catch((error: unknown) => log.warn(`Could not delete Download Station tasks`, error));
    }
    await this.deleteFromDebrid(job);
  }

  /** Removes completed and cancelled jobs (failed ones stay, to be retried or removed). */
  clearFinished(owner: string): void {
    const removed = this.jobs.filter(
      (job) => job.owner === owner && (job.status === 'completed' || job.status === 'cancelled'),
    );
    if (!removed.length) return;
    this.deps.file.data.jobs = this.jobs.filter((job) => !removed.includes(job));
    this.deps.file.save();
    for (const job of removed) this.deps.events.emit(owner, 'job-removed', { id: job.id });
  }

  /** Resumes jobs blocked on a NAS session once their owner logs in again. */
  resumeFor(owner: string): void {
    for (const job of this.jobs) {
      if (job.owner === owner && isActive(job)) job.nextCheckAt = Date.now();
    }
  }

  toView(job: Job): JobView {
    return {
      id: job.id,
      name: job.name,
      provider: job.provider,
      categoryName: job.categoryName,
      categoryIcon: job.categoryIcon,
      destination: joinPath(job.destination, job.folder),
      status: job.status,
      size: job.size,
      progress: job.progress,
      speed: job.speed,
      seeders: job.seeders,
      detail: job.detail,
      error: job.error,
      files: job.files.map((file) => ({
        // Relative to `destination`, which already includes the torrent folder.
        path:
          job.folder && file.path.startsWith(`${job.folder}/`)
            ? file.path.slice(job.folder.length + 1)
            : file.path,
        size: file.size,
        status: file.status,
        progress: file.size > 0 ? Math.min(1, file.downloaded / file.size) : null,
      })),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      finishedAt: job.finishedAt,
    };
  }

  private changed(job: Job): void {
    // Removed while being processed: do not bring it back in the web app.
    if (!this.jobs.includes(job)) return;
    job.updatedAt = Date.now();
    this.deps.file.save();
    this.deps.events.emit(job.owner, 'job', this.toView(job));
  }

  private prune(): void {
    const now = Date.now();
    const counts = new Map<string, number>();
    const kept = this.jobs.filter((job) => {
      if (isActive(job)) return true;
      if (job.finishedAt && now - job.finishedAt > FINISHED_RETENTION_MS) return false;
      const count = (counts.get(job.owner) ?? 0) + 1;
      counts.set(job.owner, count);
      return count <= MAX_JOBS_PER_USER;
    });
    if (kept.length !== this.jobs.length) {
      this.deps.file.data.jobs = kept;
      this.deps.file.save();
    }
  }

  /**
   * Runs the jobs that are due. Jobs still being processed (a long pack being sent) are
   * skipped, so they never hold the others back. Resolves once the started jobs are done.
   */
  async tick(): Promise<void> {
    const now = Date.now();
    const due = this.jobs.filter(
      (job) => isActive(job) && job.nextCheckAt <= now && !this.busy.has(job.id),
    );
    await Promise.all(due.map((job) => this.process(job)));
  }

  private async process(job: Job): Promise<void> {
    this.busy.add(job.id);
    try {
      if (job.status === 'debrid') await this.checkDebrid(job);
      if (job.status === 'sending' || job.status === 'waiting_login') await this.send(job);
      else if (job.status === 'downloading') await this.checkDownloads(job);
      job.failures = 0;
    } catch (error) {
      this.handleError(job, error);
    } finally {
      this.busy.delete(job.id);
    }
  }

  private handleError(job: Job, error: unknown): void {
    if (error instanceof NasSessionError) {
      this.deps.sessions.markDsmInvalid(error.sid);
      if (job.status === 'sending') job.status = 'waiting_login';
      job.nextCheckAt = Date.now() + 5000;
      this.changed(job);
      return;
    }
    const info = toErrorInfo(error);
    const transient = !(error instanceof AppError) || TRANSIENT_CODES.has(info.code);
    job.failures++;
    if (transient && job.failures < MAX_FAILURES) {
      log.warn(`Job "${job.name}": ${info.code} (${info.message ?? ''}), retrying`);
      job.nextCheckAt = Date.now() + Math.min(60_000, 2000 * 2 ** Math.min(job.failures, 5));
      return;
    }
    log.warn(`Job "${job.name}" failed: ${info.code} ${info.message ?? ''}`);
    this.fail(job, info);
  }

  private fail(job: Job, error: ErrorInfo): void {
    job.phase =
      job.status === 'debrid' ? 'debrid' : job.status === 'downloading' ? 'downloading' : 'sending';
    job.status = 'error';
    job.error = error;
    job.speed = null;
    job.finishedAt = Date.now();
    this.changed(job);
  }

  /** Polls faster when someone is looking at the app. */
  private delay(job: Job, idle: number, watched: number): number {
    return this.deps.events.isWatching(job.owner) ? watched : idle;
  }

  private async checkDebrid(job: Job): Promise<void> {
    const status = await this.deps.provider(job.provider).status(job.debridId);
    if (status.id) job.debridId = status.id;
    if (status.name) job.name = status.name;
    if (status.size) job.size = status.size;
    job.progress = status.progress;
    job.speed = status.speed;
    job.seeders = status.seeders;
    job.detail = status.detail;

    if (status.state === 'error') {
      this.fail(job, (status.error ?? new AppError('torrent_failed')).toInfo());
      return;
    }
    if (status.state === 'ready') {
      job.status = 'sending';
      job.progress = null;
      job.speed = null;
      job.seeders = null;
      job.detail = null;
      this.changed(job);
      return;
    }
    const age = Date.now() - job.createdAt;
    const idle = age < 120_000 ? 3000 : age < 600_000 ? 10_000 : 30_000;
    job.nextCheckAt = Date.now() + this.delay(job, idle, Math.min(idle, 4000));
    this.changed(job);
  }

  private async send(job: Job): Promise<void> {
    const sid = this.deps.sessions.dsmSidFor(job.owner);
    if (!sid) {
      if (job.status !== 'waiting_login') {
        job.status = 'waiting_login';
        this.changed(job);
      }
      job.nextCheckAt = Date.now() + 10_000;
      return;
    }
    if (job.status === 'waiting_login') {
      job.status = 'sending';
      this.changed(job);
    }

    const provider = this.deps.provider(job.provider);
    if (job.files.length === 0) {
      const content = await provider.files(job.debridId);
      const plan = planDownload(content, this.deps.options().createSubfolder);
      job.folder = plan.folder;
      job.files = plan.files.map((file) => ({
        ...file,
        url: null,
        taskId: null,
        status: 'pending',
        downloaded: 0,
        speed: 0,
        error: null,
      }));
      job.size = job.files.reduce((sum, file) => sum + file.size, 0) || job.size;
      this.changed(job);
    }

    const pending = job.files.filter((file) => file.status === 'pending');
    const folderOf = (file: JobFile) => joinPath(job.destination, dirname(file.path));
    const folders = [...new Set(pending.map(folderOf))].filter((f) => f !== job.destination);
    if (folders.length) await this.deps.nas.createFolders(sid, folders);

    // One file at a time: links are generated just before Download Station gets them, and
    // what was already sent is kept if something fails halfway.
    for (const file of pending) {
      // Cancelled meanwhile.
      if (!this.jobs.includes(job)) return;
      const url = await provider.unlock(job.debridId, {
        path: file.path,
        size: file.size,
        ref: file.ref,
      });
      const [taskId] = await this.deps.nas.createDownloadTasks(sid, [url], folderOf(file));
      file.url = url;
      file.taskId = taskId ?? null;
      file.status = 'queued';
      this.changed(job);
    }

    job.status = 'downloading';
    job.phase = 'downloading';
    job.progress = 0;
    job.nextCheckAt = Date.now() + 2000;
    this.changed(job);
  }

  private async checkDownloads(job: Job): Promise<void> {
    const sid = this.deps.sessions.dsmSidFor(job.owner);
    if (!sid) {
      // Download Station keeps downloading; progress resumes once the user logs in again.
      job.nextCheckAt = Date.now() + 30_000;
      return;
    }
    // Download Station did not return some task ids: find them by URL.
    const unmatched = job.files.filter(
      (file) => !file.taskId && file.url && file.status !== 'completed',
    );
    if (unmatched.length) {
      const byUrl = new Map(
        (await this.deps.nas.listTasks(sid)).map((task) => [task.uri, task.id]),
      );
      for (const file of unmatched) file.taskId = byUrl.get(file.url) ?? null;
    }

    const ids = job.files.map((file) => file.taskId).filter((id): id is string => !!id);
    const tasks = new Map((await this.deps.nas.getTasks(sid, ids)).map((task) => [task.id, task]));

    for (const file of job.files) {
      const task = file.taskId ? tasks.get(file.taskId) : undefined;
      if (!task) {
        // Removed from Download Station (by hand or by its auto-clean).
        if (file.status !== 'completed') file.status = 'removed';
        file.speed = 0;
        continue;
      }
      const wasCompleted = file.status === 'completed';
      file.status = fileStatusFromTask(task);
      if (file.status === 'completed' && !wasCompleted)
        await this.fixFileName(job, sid, file, task);
      file.downloaded = file.status === 'completed' ? file.size || task.size : task.downloaded;
      file.speed = file.status === 'downloading' ? task.speed : 0;
      file.error = task.error;
    }

    const total = job.files.reduce((sum, file) => sum + file.size, 0);
    const downloaded = job.files.reduce(
      (sum, file) => sum + (file.status === 'completed' ? file.size : file.downloaded),
      0,
    );
    job.progress = total > 0 ? Math.min(1, downloaded / total) : null;
    job.speed = job.files.reduce((sum, file) => sum + file.speed, 0);

    const pending = job.files.some((file) =>
      ['queued', 'downloading', 'pending'].includes(file.status),
    );
    const failed = job.files.filter((file) => file.status === 'error');
    if (!pending) {
      if (failed.length) {
        const message = [...new Set(failed.map((file) => file.error).filter(Boolean))].join(', ');
        this.fail(job, { code: 'download_failed', ...(message ? { message } : {}) });
        return;
      }
      const allRemoved = job.files.every((file) => file.status === 'removed');
      job.status = allRemoved ? 'cancelled' : 'completed';
      if (allRemoved) job.error = { code: 'task_removed' };
      job.speed = null;
      job.finishedAt = Date.now();
      this.changed(job);
      if (!allRemoved && this.deps.options().deleteFromDebrid) await this.deleteFromDebrid(job);
      return;
    }

    job.nextCheckAt = Date.now() + this.delay(job, 20_000, 2500);
    this.changed(job);
  }

  /** Gives the file its expected name when Download Station picked another one. */
  private async fixFileName(job: Job, sid: string, file: JobFile, task: DsTask): Promise<void> {
    const expected = basename(file.path);
    if (!task.title || task.title === expected) return;
    // The name comes from Download Station: a path in it would point outside the folder.
    if (!isPlainName(task.title)) {
      log.warn(`Not renaming "${task.title}": not a plain file name`);
      return;
    }
    const folder = joinPath(job.destination, dirname(file.path));
    try {
      await this.deps.nas.rename(sid, joinPath(folder, task.title), expected);
    } catch (error) {
      log.warn(`Could not rename "${task.title}" to "${expected}"`, toErrorInfo(error));
    }
  }

  private async deleteFromDebrid(job: Job): Promise<void> {
    try {
      await this.deps.provider(job.provider).delete(job.debridId);
    } catch (error) {
      log.warn(`Could not delete "${job.name}" from ${job.provider}`, toErrorInfo(error));
    }
  }
}
