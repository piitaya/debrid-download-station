import { LitElement, css, html, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { extractMagnets, type MagnetInfo } from '../../shared/magnet.js';
import { parseTorrent } from '../../shared/torrent.js';
import { PROVIDERS, type Category, type ProviderId } from '../../shared/types.js';
import { api, ApiError } from '../api.js';
import { formatBytes } from '../format.js';
import { errorMessage, t } from '../i18n.js';
import {
  categoryIcon,
  mdiAlertCircleOutline,
  mdiCheck,
  mdiClose,
  mdiContentPaste,
  mdiFileDocumentOutline,
  mdiLinkVariant,
} from '../icons.js';
import { store, StoreController } from '../store.js';
import './icon.js';
import type { DdsSheet } from './sheet.js';
import './sheet.js';
import { sharedStyles } from './styles.js';

interface TorrentItem {
  id: number;
  file: File;
  name: string;
  size: number;
  fileCount: number;
}

interface Failure {
  input: string;
  message: string;
}

const STORAGE_PROVIDER = 'dds.provider';
const STORAGE_CATEGORY = 'dds.category';
const MAX_TORRENT_SIZE = 10 * 1024 * 1024;

const readStorage = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing: not remembering the choice is fine.
  }
};

// iOS greys out files whose type it does not know when `accept` is set.
const isIOS =
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);

// The async clipboard API only exists on HTTPS (or localhost).
const canReadClipboard = window.isSecureContext && 'clipboard' in navigator;

const hasFinePointer = window.matchMedia('(pointer: fine)').matches;

const shortHash = (hash: string) =>
  hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;

@customElement('dds-add-sheet')
export class DdsAddSheet extends LitElement {
  @state() private text = '';
  @state() private torrents: TorrentItem[] = [];
  @state() private provider: ProviderId | null = null;
  @state() private categoryId: string | null = null;
  @state() private busy = false;
  @state() private failures: Failure[] = [];

  @query('dds-sheet') private sheet!: DdsSheet;
  @query('textarea') private textarea?: HTMLTextAreaElement;
  @query('input[type="file"]') private fileInput!: HTMLInputElement;

  private nextId = 1;

  constructor() {
    super();
    new StoreController(this);
  }

  get isOpen(): boolean {
    return this.sheet?.open ?? false;
  }

  /** Opens the sheet, optionally with links or .torrent files to add. */
  async open(options: { text?: string; files?: File[] } = {}): Promise<void> {
    if (!this.isOpen) {
      this.text = '';
      this.torrents = [];
      this.failures = [];
    }
    if (options.text?.trim()) this.appendText(options.text);
    if (options.files?.length) await this.addFiles(options.files);
    await this.sheet.show();
    if (hasFinePointer && !options.text && !options.files?.length) this.textarea?.focus();
  }

  override updated(): void {
    // The field grows with its content, up to a few lines.
    const field = this.textarea;
    if (field) {
      field.style.height = 'auto';
      field.style.height = `${Math.min(field.scrollHeight, 200)}px`;
    }
  }

  private get configured(): boolean {
    return this.providers.length > 0 && (store.settings?.categories.length ?? 0) > 0;
  }

  private get providers(): ProviderId[] {
    return store.settings?.providers.filter((p) => p.configured).map((p) => p.id) ?? [];
  }

  private get selectedProvider(): ProviderId | null {
    const providers = this.providers;
    const candidates = [
      this.provider,
      readStorage(STORAGE_PROVIDER),
      store.settings?.defaultProvider,
    ];
    const found = candidates.find((id) => id && providers.includes(id as ProviderId));
    return (found as ProviderId | undefined) ?? providers[0] ?? null;
  }

  private get selectedCategory(): Category | null {
    const categories = store.settings?.categories ?? [];
    const ids = [this.categoryId, readStorage(STORAGE_CATEGORY), store.settings?.defaultCategoryId];
    for (const id of ids) {
      const category = categories.find((item) => item.id === id);
      if (category) return category;
    }
    return categories[0] ?? null;
  }

  private appendText(value: string): void {
    this.text = this.text.trim() ? `${this.text.trim()}\n${value.trim()}` : value.trim();
  }

  private async paste(): Promise<void> {
    try {
      const value = await navigator.clipboard.readText();
      if (value.trim()) this.appendText(value);
    } catch {
      this.textarea?.focus();
    }
  }

  private async addFiles(files: File[]): Promise<void> {
    for (const file of files) {
      try {
        if (file.size > MAX_TORRENT_SIZE) throw new Error('too big');
        const meta = parseTorrent(new Uint8Array(await file.arrayBuffer()));
        this.torrents = [
          ...this.torrents,
          {
            id: this.nextId++,
            file,
            name: meta.name,
            size: meta.totalSize,
            fileCount: meta.files.length,
          },
        ];
      } catch {
        store.toast(t('add.notTorrent', { name: file.name }), 'error');
      }
    }
  }

  private onFileChange(): void {
    void this.addFiles([...(this.fileInput.files ?? [])]);
    this.fileInput.value = '';
  }

  private removeMagnet(magnet: MagnetInfo): void {
    this.text = this.text
      .split(/\s+/)
      .filter((token) => token && !token.includes(magnet.hash ?? magnet.uri))
      .join('\n');
  }

  private selectProvider(id: ProviderId): void {
    this.provider = id;
    writeStorage(STORAGE_PROVIDER, id);
  }

  private selectCategory(id: string): void {
    this.categoryId = id;
    writeStorage(STORAGE_CATEGORY, id);
  }

  private async submit(): Promise<void> {
    const provider = this.selectedProvider;
    const category = this.selectedCategory;
    const { magnets } = extractMagnets(this.text);
    if (!provider || !category || (!magnets.length && !this.torrents.length)) return;

    const form = new FormData();
    form.set('provider', provider);
    form.set('categoryId', category.id);
    for (const magnet of magnets) form.append('magnets', magnet.uri);
    for (const torrent of this.torrents) form.append('torrents', torrent.file, torrent.file.name);

    this.busy = true;
    this.failures = [];
    try {
      const { results } = await api.addJobs(form);
      const failures: Failure[] = [];
      let added = 0;
      for (const result of results) {
        if (result.ok) {
          store.upsertJob(result.job);
          added++;
        } else {
          failures.push({ input: result.input, message: errorMessage(result.error.code) });
        }
      }
      if (added) store.toast(t('add.added', { count: added }), 'success');

      if (!failures.length) {
        this.sheet.close();
        return;
      }
      // Keep only what failed, so that it can be fixed and sent again.
      const failed = new Set(failures.map((failure) => failure.input));
      this.text = magnets
        .filter((magnet) => failed.has(magnet.uri))
        .map((magnet) => magnet.uri)
        .join('\n');
      this.torrents = this.torrents.filter((torrent) => failed.has(torrent.file.name));
      this.failures = failures;
    } catch (error) {
      store.toast(errorMessage(error instanceof ApiError ? error.info.code : 'internal'), 'error');
    } finally {
      this.busy = false;
    }
  }

  override render() {
    const { magnets, invalid } = extractMagnets(this.text);
    const count = magnets.length + this.torrents.length;
    const provider = this.selectedProvider;
    const category = this.selectedCategory;

    return html`
      <dds-sheet
        heading=${t('add.title')}
        primaryLabel=${count > 1 ? t('add.submitCount', { count }) : t('add.submit')}
        ?primaryDisabled=${!count || !provider || !category}
        ?busy=${this.busy}
        @dds-primary=${this.submit}
      >
        ${this.configured ? nothing : this.renderNotConfigured()}

        <section class="section">
          <div class="section-header">${t('add.links')}</div>
          <div class="group input-group">
            <textarea
              rows="3"
              placeholder=${t('add.placeholder')}
              aria-label=${t('add.links')}
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
              .value=${this.text}
              @input=${(event: InputEvent) => {
                this.text = (event.target as HTMLTextAreaElement).value;
              }}
            ></textarea>
            <div class="toolbar">
              ${
                canReadClipboard
                  ? html`<button class="btn btn-plain btn-sm" @click=${this.paste}>
                      <dds-icon .path=${mdiContentPaste}></dds-icon>${t('add.paste')}
                    </button>`
                  : nothing
              }
              <button class="btn btn-plain btn-sm" @click=${() => this.fileInput.click()}>
                <dds-icon .path=${mdiFileDocumentOutline}></dds-icon>${t('add.chooseFile')}
              </button>
            </div>
          </div>
          ${
            invalid.length
              ? html`<div class="section-footer warning-text">
                  ${t('add.invalid', { count: invalid.length })}
                </div>`
              : nothing
          }
          <input
            type="file"
            multiple
            accept=${isIOS ? '' : '.torrent,application/x-bittorrent'}
            hidden
            @change=${this.onFileChange}
          />
        </section>

        ${count ? this.renderItems(magnets) : nothing}
        ${this.configured ? this.renderChoices(provider, category) : nothing}
        ${this.failures.length ? this.renderFailures() : nothing}
      </dds-sheet>
    `;
  }

  private renderNotConfigured() {
    return html`<div class="section">
      <div class="notice neutral">
        <dds-icon .path=${mdiAlertCircleOutline}></dds-icon>
        <span>${t('add.notConfigured')}</span>
      </div>
    </div>`;
  }

  private renderItems(magnets: MagnetInfo[]) {
    return html`<section class="section">
      <div class="group with-icons items">
        ${magnets.map(
          (magnet) =>
            html`<div class="row">
              <span class="row-icon"><dds-icon .path=${mdiLinkVariant}></dds-icon></span>
              <span class="row-main">
                <span class="row-title ellipsis">${magnet.name ?? t('add.unnamed')}</span>
                ${
                  magnet.hash
                    ? html`<span class="row-subtitle mono">${shortHash(magnet.hash)}</span>`
                    : nothing
                }
              </span>
              <button
                class="icon-btn remove"
                aria-label=${t('add.remove')}
                @click=${() => this.removeMagnet(magnet)}
              >
                <dds-icon .path=${mdiClose}></dds-icon>
              </button>
            </div>`,
        )}
        ${this.torrents.map(
          (torrent) =>
            html`<div class="row">
              <span class="row-icon"><dds-icon .path=${mdiFileDocumentOutline}></dds-icon></span>
              <span class="row-main">
                <span class="row-title ellipsis">${torrent.name}</span>
                <span class="row-subtitle num"
                  >${formatBytes(torrent.size)} ·
                  ${t('downloads.fileCount', { count: torrent.fileCount })}</span
                >
              </span>
              <button
                class="icon-btn remove"
                aria-label=${t('add.remove')}
                @click=${() => {
                  this.torrents = this.torrents.filter((item) => item.id !== torrent.id);
                }}
              >
                <dds-icon .path=${mdiClose}></dds-icon>
              </button>
            </div>`,
        )}
      </div>
    </section>`;
  }

  private renderChoices(provider: ProviderId | null, category: Category | null) {
    const categories = store.settings?.categories ?? [];
    const providers = this.providers;
    return html`
      <section class="section">
        <div class="section-header">${t('add.destination')}</div>
        <div class="group with-icons" role="radiogroup" aria-label=${t('add.destination')}>
          ${categories.map(
            (item) =>
              html`<button
                class="row"
                role="radio"
                aria-checked=${item.id === category?.id}
                @click=${() => this.selectCategory(item.id)}
              >
                <span class="row-icon"><dds-icon .path=${categoryIcon(item.icon)}></dds-icon></span>
                <span class="row-main">
                  <span class="row-title">${item.name}</span>
                  <span class="row-subtitle ellipsis">${item.destination}</span>
                </span>
                ${
                  item.id === category?.id
                    ? html`<dds-icon class="check" .path=${mdiCheck}></dds-icon>`
                    : nothing
                }
              </button>`,
          )}
        </div>
      </section>

      ${
        providers.length > 1
          ? html`<section class="section">
              <div class="section-header">${t('add.service')}</div>
              <div class="segmented" role="group" aria-label=${t('add.service')}>
                ${providers.map(
                  (id) =>
                    html`<button
                      aria-pressed=${id === provider}
                      @click=${() => this.selectProvider(id)}
                    >
                      ${PROVIDERS[id].name}
                    </button>`,
                )}
              </div>
            </section>`
          : nothing
      }
    `;
  }

  private renderFailures() {
    return html`<div class="section">
      <div class="notice" role="alert">
        <dds-icon .path=${mdiAlertCircleOutline}></dds-icon>
        <div>
          <strong>${t('add.failed', { count: this.failures.length })}</strong>
          ${this.failures.map(
            (failure) =>
              html`<div class="failure">
                <span class="ellipsis">${failure.input}</span>
                <span>${failure.message}</span>
              </div>`,
          )}
        </div>
      </div>
    </div>`;
  }

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: contents;
      }

      .section:first-child {
        margin-top: 4px;
      }

      .input-group {
        transition: box-shadow 0.15s ease;
      }

      .input-group:focus-within {
        box-shadow: var(--focus-ring);
      }

      textarea {
        display: block;
        width: 100%;
        min-height: 92px;
        max-height: 200px;
        padding: 12px 16px;
        border: none;
        font: inherit;
        font-size: 16px;
        line-height: 1.4;
        color: var(--text);
        background: transparent;
        outline: none;
        resize: none;
        word-break: break-all;
      }

      textarea::placeholder {
        color: var(--text-tertiary);
      }

      /* The whole group shows the focus ring. */
      textarea:focus-visible {
        box-shadow: none;
      }

      .section-footer.warning-text {
        color: var(--warning);
      }

      @media (pointer: fine) {
        textarea {
          font-size: 15px;
        }
      }

      .toolbar {
        position: relative;
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        padding: 6px 8px;
      }

      .toolbar::before {
        content: '';
        position: absolute;
        top: 0;
        right: 0;
        left: 16px;
        height: 1px;
        background: var(--separator);
        transform: scaleY(0.5);
      }

      .items .row {
        padding-right: 8px;
      }

      .remove {
        width: 32px;
        height: 32px;
      }

      .remove dds-icon {
        --icon-size: 18px;
      }

      .notice.neutral {
        color: var(--text-secondary);
        background: var(--bg-elevated);
      }

      .failure {
        display: flex;
        gap: 6px;
        min-width: 0;
        margin-top: 4px;
        color: var(--text-secondary);
      }

      .failure .ellipsis {
        max-width: 55%;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'dds-add-sheet': DdsAddSheet;
  }
}
