import { LitElement, css, html, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import type { ErrorCode, FolderEntry } from '../../shared/types.js';
import { api, ApiError } from '../api.js';
import { breakable } from '../format.js';
import { errorMessage, locale, t } from '../i18n.js';
import { mdiAlertCircleOutline, mdiChevronRight, mdiFolderOutline, mdiPlus } from '../icons.js';
import { store } from '../store.js';
import './icon.js';
import type { DdsSheet } from './sheet.js';
import './sheet.js';
import { sharedStyles } from './styles.js';

/**
 * Normalizes a Download Station path like the server does (`/video//Films/` → `video/Films`);
 * empty when invalid.
 */
export function normalizePath(value: string): string {
  const parts = value
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.some((part) => part === '.' || part === '..') ? '' : parts.join('/');
}

const errorCode = (error: unknown): ErrorCode =>
  error instanceof ApiError ? error.info.code : 'internal';

const byName = (a: FolderEntry, b: FolderEntry) =>
  a.name.localeCompare(b.name, locale, { numeric: true, sensitivity: 'base' });

/**
 * Browses the NAS folders. Fires `dds-pick` (`CustomEvent<string>`, a Download Station path such
 * as `video/Films`) when a folder is chosen.
 */
@customElement('dds-folder-picker')
export class DdsFolderPicker extends LitElement {
  /** Listed folder; null for the shared folders. */
  @state() private path: string | null = null;
  @state() private folders: FolderEntry[] = [];
  @state() private loading = false;
  @state() private error: ErrorCode | null = null;
  /** The "new folder" row is being edited. */
  @state() private creating = false;
  @state() private newName = '';
  @state() private busy = false;

  @query('dds-sheet') private sheet!: DdsSheet;
  @query('.new-folder input') private newInput?: HTMLInputElement;

  /** Ignores the answers of listings that are no longer wanted. */
  private loadRun = 0;

  /** Opens at `initialPath` when it exists, otherwise at the shared folders. */
  async open(initialPath?: string): Promise<void> {
    const start = normalizePath(initialPath ?? '');
    void this.load(start || null, !!start);
    await this.updateComplete;
    await this.sheet.show();
  }

  private async load(path: string | null, fallBackToShares = false): Promise<void> {
    const run = ++this.loadRun;
    this.path = path;
    this.folders = [];
    this.error = null;
    this.loading = true;
    this.creating = false;
    this.newName = '';
    try {
      const listing = await api.folders(path ?? undefined);
      if (run !== this.loadRun) return;
      this.path = listing.path;
      this.folders = [...listing.folders].sort(byName);
      this.loading = false;
    } catch (error) {
      if (run !== this.loadRun) return;
      if (fallBackToShares) return this.load(null);
      this.error = errorCode(error);
      this.loading = false;
    }
  }

  private async startCreating(): Promise<void> {
    this.creating = true;
    await this.updateComplete;
    this.newInput?.focus();
  }

  private stopCreating(): void {
    this.creating = false;
    this.newName = '';
  }

  private async create(): Promise<void> {
    const name = this.newName.trim();
    if (!name || this.path === null || this.busy) return;
    this.busy = true;
    try {
      const folder = await api.createFolder(this.path, name);
      this.busy = false;
      await this.load(folder.path);
    } catch (error) {
      store.toast(errorMessage(errorCode(error)), 'error');
    } finally {
      this.busy = false;
    }
  }

  private onNewKeyDown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      void this.create();
    } else if (event.key === 'Escape') {
      // Leaves the dialog open.
      event.preventDefault();
      event.stopPropagation();
      this.stopCreating();
    }
  }

  private onNewBlur(): void {
    if (!this.newName.trim() && !this.busy) this.stopCreating();
  }

  private choose(): void {
    if (this.path === null) return;
    this.dispatchEvent(new CustomEvent<string>('dds-pick', { detail: this.path }));
    this.sheet.close();
  }

  override render() {
    return html`
      <dds-sheet
        heading=${t('picker.title')}
        primaryLabel=${t('picker.choose')}
        ?primaryDisabled=${this.path === null || this.loading || !!this.error}
        @dds-primary=${this.choose}
      >
        ${this.renderBreadcrumb()}
        ${this.error
          ? html`<div class="notice" role="alert">
              <dds-icon .path=${mdiAlertCircleOutline}></dds-icon>
              <span>${t('picker.error')} ${errorMessage(this.error)}</span>
            </div>`
          : this.renderList()}
      </dds-sheet>
    `;
  }

  private renderBreadcrumb() {
    const parts = this.path ? this.path.split('/') : [];
    const crumbs = [
      { label: t('picker.shares'), path: null as string | null },
      ...parts.map((part, index) => ({ label: part, path: parts.slice(0, index + 1).join('/') })),
    ];
    return html`<nav class="crumbs" aria-label=${t('picker.location')}>
      ${crumbs.map((crumb, index) => {
        const current = index === crumbs.length - 1;
        return html`${index ? html`<dds-icon class="separator" .path=${mdiChevronRight}></dds-icon>` : nothing}${current
            ? html`<span class="crumb current" aria-current="location">${crumb.label}</span>`
            : html`<button class="btn btn-plain btn-sm crumb" @click=${() => this.load(crumb.path)}>
                <span>${crumb.label}</span>
              </button>`}`;
      })}
    </nav>`;
  }

  private renderList() {
    return html`<div class="group with-icons" aria-busy=${this.loading ? 'true' : 'false'}>
      ${this.loading
        ? html`<div class="row message"><span class="spinner"></span></div>`
        : this.folders.length
          ? this.folders.map(
              (folder) =>
                html`<button class="row" @click=${() => this.load(folder.path)}>
                  <span class="row-icon"><dds-icon .path=${mdiFolderOutline}></dds-icon></span>
                  <span class="row-main"><span class="row-title">${breakable(folder.name)}</span></span>
                  <dds-icon class="chevron" .path=${mdiChevronRight}></dds-icon>
                </button>`,
            )
          : html`<div class="row message">${t('picker.empty')}</div>`}
      ${this.path !== null && !this.loading ? this.renderNewFolder() : nothing}
    </div>`;
  }

  private renderNewFolder() {
    if (!this.creating) {
      return html`<button class="row add" @click=${this.startCreating}>
        <span class="row-icon accent"><dds-icon .path=${mdiPlus}></dds-icon></span>
        <span class="row-main"><span class="row-title">${t('picker.newFolder')}</span></span>
      </button>`;
    }
    return html`<div class="row new-folder">
      <span class="row-icon"><dds-icon .path=${mdiFolderOutline}></dds-icon></span>
      <input
        class="inline-input"
        .value=${live(this.newName)}
        placeholder=${t('picker.newFolderName')}
        aria-label=${t('picker.newFolderName')}
        maxlength="255"
        autocomplete="off"
        @input=${(event: Event) => (this.newName = (event.target as HTMLInputElement).value)}
        @keydown=${this.onNewKeyDown}
        @blur=${this.onNewBlur}
      />
      <button
        class="btn btn-sm btn-primary"
        ?disabled=${!this.newName.trim() || this.busy}
        @click=${this.create}
      >
        ${this.busy ? html`<span class="spinner"></span>` : t('picker.create')}
      </button>
    </div>`;
  }

  static override styles = [
    sharedStyles,
    css`
      .row:focus-visible {
        box-shadow: inset var(--focus-ring);
      }

      .crumbs {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 2px;
        min-height: 30px;
        margin: 0 0 8px;
        padding: 0 6px;
      }

      .crumb {
        max-width: 100%;
      }

      .crumb span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .crumb.current {
        padding: 0 10px;
        overflow: hidden;
        font-size: 13px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .separator {
        --icon-size: 14px;
        color: var(--text-tertiary);
      }

      .row-title {
        overflow-wrap: anywhere;
      }

      .message {
        justify-content: center;
        color: var(--text-secondary);
      }

      .message .spinner {
        color: var(--text-tertiary);
      }

      .add {
        color: var(--accent);
      }

      .new-folder .btn {
        min-width: 64px;
      }

      .new-folder .spinner {
        width: 14px;
        height: 14px;
      }

      .inline-input {
        flex: 1;
        min-width: 0;
        min-height: 32px;
        padding: 0;
        border: none;
        border-radius: 0;
        font: inherit;
        /* 16px keeps iOS Safari from zooming in on focus. */
        font-size: 16px;
        color: var(--text);
        background: transparent;
        outline: none;
      }

      .inline-input:focus-visible {
        box-shadow: none;
      }

      .inline-input::placeholder {
        color: var(--text-tertiary);
      }

      @media (pointer: fine) {
        .inline-input {
          font-size: 15px;
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'dds-folder-picker': DdsFolderPicker;
  }
}
