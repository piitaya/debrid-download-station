import { LitElement, css, html, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { extractMagnets } from '../../shared/magnet.js';
import { parseTorrent } from '../../shared/torrent.js';
import { PROVIDERS, type ProviderId } from '../../shared/types.js';
import { api, ApiError } from '../api.js';
import { formatBytes } from '../format.js';
import { errorMessage, t } from '../i18n.js';
import {
  categoryIcon,
  mdiAlertCircleOutline,
  mdiArrowDown,
  mdiClose,
  mdiContentPaste,
  mdiFileDocumentOutline,
  mdiMagnet,
  mdiSend,
  mdiTrayArrowDown,
} from '../icons.js';
import { store, StoreController } from '../store.js';
import './icon.js';
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

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** Magnet link passed in the URL (`?magnet=`), e.g. by the browser's magnet handler. */
function takeUrlMagnet(): string {
  const params = new URLSearchParams(location.search);
  const magnet = params.get('magnet');
  if (!magnet) return '';
  params.delete('magnet');
  const search = params.toString();
  history.replaceState(
    null,
    '',
    `${location.pathname}${search ? `?${search}` : ''}${location.hash}`,
  );
  return magnet;
}

@customElement('dds-add-card')
export class DdsAddCard extends LitElement {
  @state() private text = takeUrlMagnet();
  @state() private torrents: TorrentItem[] = [];
  @state() private provider: ProviderId | null = null;
  @state() private categoryId: string | null = null;
  @state() private busy = false;
  @state() private dragging = false;
  @state() private failures: Failure[] = [];

  @query('input[type="file"]') private fileInput!: HTMLInputElement;
  @query('textarea') private textarea!: HTMLTextAreaElement;

  private nextId = 1;
  private dragDepth = 0;

  constructor() {
    super();
    new StoreController(this);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('dragenter', this.onDragEnter);
    window.addEventListener('dragover', this.onDragOver);
    window.addEventListener('dragleave', this.onDragLeave);
    window.addEventListener('drop', this.onDrop);
    window.addEventListener('paste', this.onWindowPaste);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('dragenter', this.onDragEnter);
    window.removeEventListener('dragover', this.onDragOver);
    window.removeEventListener('dragleave', this.onDragLeave);
    window.removeEventListener('drop', this.onDrop);
    window.removeEventListener('paste', this.onWindowPaste);
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
    return (
      (candidates.find((id) => id && providers.includes(id as ProviderId)) as ProviderId) ??
      providers[0] ??
      null
    );
  }

  private get selectedCategory() {
    const categories = store.settings?.categories ?? [];
    const ids = [this.categoryId, readStorage(STORAGE_CATEGORY), store.settings?.defaultCategoryId];
    for (const id of ids) {
      const category = categories.find((c) => c.id === id);
      if (category) return category;
    }
    return categories[0] ?? null;
  }

  // Drag & drop anywhere on the page.
  private readonly onDragEnter = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    this.dragDepth++;
    this.dragging = true;
  };

  private readonly onDragOver = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  private readonly onDragLeave = () => {
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.dragging = false;
  };

  private readonly onDrop = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    this.dragDepth = 0;
    this.dragging = false;
    void this.addFiles([...event.dataTransfer.files]);
  };

  /** Pasting anywhere on the page (outside a field) fills the form. */
  private readonly onWindowPaste = (event: ClipboardEvent) => {
    if (isEditable(event.composedPath()[0] ?? null)) return;
    const files = [...(event.clipboardData?.files ?? [])];
    const text = event.clipboardData?.getData('text') ?? '';
    if (files.length) void this.addFiles(files);
    if (text.trim()) this.appendText(text);
  };

  private appendText(value: string): void {
    this.text = this.text.trim() ? `${this.text.trim()}\n${value.trim()}` : value.trim();
  }

  private async pasteFromClipboard(): Promise<void> {
    try {
      const value = await navigator.clipboard.readText();
      if (value.trim()) this.appendText(value);
      this.textarea.focus();
    } catch {
      this.textarea.focus();
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

  private selectProvider(id: ProviderId): void {
    this.provider = id;
    writeStorage(STORAGE_PROVIDER, id);
  }

  private selectCategory(id: string): void {
    this.categoryId = id;
    writeStorage(STORAGE_CATEGORY, id);
  }

  private async submit(event: Event): Promise<void> {
    event.preventDefault();
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
      const added = results.filter((result) => result.ok);
      const failures: Failure[] = [];
      for (const result of results) {
        if (result.ok) store.upsertJob(result.job);
        else failures.push({ input: result.input, message: errorMessage(result.error.code) });
      }

      // Keep only what failed in the form, so it can be retried.
      const failedInputs = new Set(failures.map((failure) => failure.input));
      this.text = magnets
        .filter((magnet) => failedInputs.has(magnet.uri))
        .map((magnet) => magnet.uri)
        .join('\n');
      this.torrents = this.torrents.filter((torrent) => failedInputs.has(torrent.file.name));
      this.failures = failures;

      if (added.length) {
        store.toast(
          t('add.sent', { count: added.length, provider: PROVIDERS[provider].name }),
          'success',
        );
      }
    } catch (error) {
      const code = error instanceof ApiError ? error.info.code : 'internal';
      store.toast(errorMessage(code), 'error');
    } finally {
      this.busy = false;
    }
  }

  override render() {
    const settings = store.settings;
    if (!settings) return nothing;
    const isAdmin = store.session?.user.isAdmin ?? false;
    const providers = this.providers;
    const provider = this.selectedProvider;
    const category = this.selectedCategory;
    const { magnets, invalid } = extractMagnets(this.text);
    const count = magnets.length + this.torrents.length;

    const missing = [
      providers.length === 0 ? t('add.noProvider') : null,
      settings.categories.length === 0 ? t('add.noCategory') : null,
    ].filter(Boolean);

    return html`
      <form class="card" @submit=${this.submit}>
        <h2>${t('add.title')}</h2>

        <textarea
          class="input"
          rows="2"
          placeholder=${t('add.placeholder')}
          aria-label=${t('add.placeholder')}
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          .value=${this.text}
          @input=${(event: InputEvent) => {
            this.text = (event.target as HTMLTextAreaElement).value;
          }}
        ></textarea>

        <div class="sources">
          ${
            canReadClipboard
              ? html`<button type="button" class="btn source" @click=${this.pasteFromClipboard}>
                  <dds-icon .path=${mdiContentPaste}></dds-icon>${t('add.paste')}
                </button>`
              : nothing
          }
          <button type="button" class="btn source" @click=${() => this.fileInput.click()}>
            <dds-icon .path=${mdiFileDocumentOutline}></dds-icon>${t('add.file')}
          </button>
        </div>
        <input
          type="file"
          multiple
          accept=${isIOS ? '' : '.torrent,application/x-bittorrent'}
          hidden
          @change=${this.onFileChange}
        />

        ${count || invalid.length ? this.renderItems(magnets, invalid) : nothing}
        ${
          missing.length
            ? html`<div class="setup">
                ${missing.map((message) => html`<p>${message}</p>`)}
                ${
                  isAdmin
                    ? html`<a class="btn btn-sm" href="#/settings">${t('add.configure')}</a>`
                    : html`<p class="muted small">${t('add.userHint')}</p>`
                }
              </div>`
            : html`
                ${
                  providers.length > 1
                    ? html`<div class="group">
                        <span class="label">${t('add.provider')}</span>
                        <div class="segmented" role="group">
                          ${providers.map(
                            (id) =>
                              html`<button
                                type="button"
                                aria-pressed=${id === provider}
                                @click=${() => this.selectProvider(id)}
                              >
                                ${PROVIDERS[id].name}
                              </button>`,
                          )}
                        </div>
                      </div>`
                    : nothing
                }
                <div class="group">
                  <span class="label">${t('add.category')}</span>
                  <div class="chips" role="group">
                    ${settings.categories.map(
                      (item) =>
                        html`<button
                          type="button"
                          class="chip"
                          aria-pressed=${item.id === category?.id}
                          @click=${() => this.selectCategory(item.id)}
                        >
                          <dds-icon .path=${categoryIcon(item.icon)}></dds-icon>${item.name}
                        </button>`,
                    )}
                  </div>
                  ${
                    category
                      ? html`<p class="destination muted small">
                          <dds-icon .path=${mdiArrowDown}></dds-icon
                          ><span class="mono ellipsis">${category.destination}</span>
                        </p>`
                      : nothing
                  }
                </div>
              `
        }
        ${
          this.failures.length
            ? html`<div class="error-box" role="alert">
                <dds-icon .path=${mdiAlertCircleOutline}></dds-icon>
                <div>
                  <strong>${t('add.failed', { count: this.failures.length })}</strong>
                  ${this.failures.map(
                    (failure) =>
                      html`<div class="failure small">
                        <span class="ellipsis">${failure.input}</span> — ${failure.message}
                      </div>`,
                  )}
                </div>
              </div>`
            : nothing
        }

        <button
          class="btn btn-primary btn-lg btn-block"
          ?disabled=${this.busy || !count || !provider || !category}
        >
          ${
            this.busy
              ? html`<span class="spinner"></span>`
              : html`<dds-icon .path=${mdiSend}></dds-icon>${
                    count > 1 ? t('add.submitCount', { count }) : t('add.submit')
                  }`
          }
        </button>
      </form>

      ${
        this.dragging
          ? html`<div class="drop-overlay">
              <div class="drop-box">
                <dds-icon .path=${mdiTrayArrowDown}></dds-icon>
                <p>${t('add.drop')}</p>
              </div>
            </div>`
          : nothing
      }
    `;
  }

  private renderItems(magnets: ReturnType<typeof extractMagnets>['magnets'], invalid: string[]) {
    return html`<ul class="items">
      ${magnets.map(
        (magnet) =>
          html`<li>
            <dds-icon class="kind" .path=${mdiMagnet}></dds-icon>
            <div class="item-text">
              <span class="ellipsis">${magnet.name ?? t('add.unnamed')}</span>
              ${
                magnet.hash
                  ? html`<span class="muted small mono ellipsis">${magnet.hash}</span>`
                  : nothing
              }
            </div>
          </li>`,
      )}
      ${this.torrents.map(
        (torrent) =>
          html`<li>
            <dds-icon class="kind" .path=${mdiFileDocumentOutline}></dds-icon>
            <div class="item-text">
              <span class="ellipsis">${torrent.name}</span>
              <span class="muted small"
                >${formatBytes(torrent.size)} ·
                ${t('jobs.fileCount', { count: torrent.fileCount })}</span
              >
            </div>
            <button
              type="button"
              class="icon-btn remove"
              aria-label=${t('add.remove')}
              @click=${() => {
                this.torrents = this.torrents.filter((item) => item.id !== torrent.id);
              }}
            >
              <dds-icon .path=${mdiClose}></dds-icon>
            </button>
          </li>`,
      )}
      ${
        invalid.length
          ? html`<li class="invalid small">
              <dds-icon class="kind" .path=${mdiAlertCircleOutline}></dds-icon>
              ${t('add.invalid', { count: invalid.length })}
            </li>`
          : nothing
      }
    </ul>`;
  }

  static override styles = [
    sharedStyles,
    css`
      form {
        display: grid;
        gap: 16px;
      }

      h2 {
        font-size: 20px;
        font-weight: 700;
        letter-spacing: -0.01em;
      }

      textarea {
        display: block;
        min-height: 84px;
        resize: vertical;
        line-height: 1.4;
        word-break: break-all;
      }

      .sources {
        display: flex;
        gap: 10px;
        margin-top: -6px;
      }

      .source {
        flex: 1;
        border: 1.5px dashed var(--surface-3);
        color: var(--text-2);
        background: transparent;
      }

      .source:hover {
        border-color: var(--accent);
        color: var(--accent);
        background: var(--accent-soft);
      }

      .items {
        display: grid;
        gap: 6px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .items li {
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 52px;
        padding: 8px 6px 8px 12px;
        border-radius: 12px;
        background: var(--surface-2);
        animation: pop 0.2s ease;
      }

      @keyframes pop {
        from {
          opacity: 0;
          transform: scale(0.98);
        }
      }

      .items .kind {
        --icon-size: 22px;
        color: var(--accent);
      }

      .item-text {
        display: grid;
        flex: 1;
        min-width: 0;
      }

      .items .remove {
        width: 36px;
        height: 36px;
      }

      .items .remove dds-icon {
        --icon-size: 18px;
      }

      .items .invalid {
        color: var(--warning);
        background: var(--warning-soft);
      }

      .items .invalid .kind {
        color: var(--warning);
      }

      .group {
        display: grid;
        gap: 10px;
      }

      .label {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-2);
      }

      .destination {
        display: flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
        margin-top: -2px;
      }

      .destination dds-icon {
        --icon-size: 16px;
        color: var(--text-3);
      }

      .setup {
        display: grid;
        justify-items: start;
        gap: 8px;
        padding: 14px 16px;
        border-radius: 14px;
        font-size: 15px;
        background: var(--warning-soft);
      }

      .setup a {
        text-decoration: none;
      }

      .failure {
        display: flex;
        gap: 4px;
        min-width: 0;
        margin-top: 4px;
        color: var(--text-2);
      }

      .failure .ellipsis {
        max-width: 50%;
      }

      .drop-overlay {
        position: fixed;
        inset: 0;
        z-index: 50;
        display: grid;
        place-items: center;
        padding: 24px;
        background: var(--backdrop);
        -webkit-backdrop-filter: blur(6px);
        backdrop-filter: blur(6px);
        pointer-events: none;
        animation: fade 0.15s ease;
      }

      @keyframes fade {
        from {
          opacity: 0;
        }
      }

      .drop-box {
        display: grid;
        justify-items: center;
        gap: 12px;
        width: min(460px, 100%);
        padding: 48px 24px;
        border: 2.5px dashed var(--accent);
        border-radius: var(--radius-lg);
        font-size: 18px;
        font-weight: 600;
        color: var(--accent);
        background: var(--surface);
      }

      .drop-box dds-icon {
        --icon-size: 48px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'dds-add-card': DdsAddCard;
  }
}
