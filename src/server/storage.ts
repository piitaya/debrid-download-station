import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { log } from './logger.js';

/**
 * A JSON document persisted to disk. Writes are debounced and atomic (temp file + rename) and
 * the file is only readable by its owner, as it may contain secrets.
 */
export class JsonFile<T> {
  data: T;
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    fallback: () => T,
  ) {
    this.data = this.read(fallback);
  }

  private read(fallback: () => T): T {
    let raw: string;
    try {
      raw = readFileSync(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback();
      throw error;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      const backup = `${this.path}.corrupt-${Date.now()}`;
      log.warn(`Unreadable JSON in ${this.path}, moved to ${backup}`);
      renameSync(this.path, backup);
      return fallback();
    }
  }

  /** Schedules a write of the current data. */
  save(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 100);
  }

  /** Writes the current data now. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const content = JSON.stringify(this.data, null, 2);
    this.writing = this.writing
      .then(async () => {
        const temp = `${this.path}.tmp`;
        await writeFile(temp, content, { mode: 0o600 });
        await rename(temp, this.path);
      })
      .catch((error: unknown) => log.error(`Failed to write ${this.path}`, error));
    return this.writing;
  }

  /** Synchronous write, for shutdown paths. */
  flushSync(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(temp, this.path);
  }
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function ensureParentDir(path: string): void {
  ensureDir(dirname(path));
}
