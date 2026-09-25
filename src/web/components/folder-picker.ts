import { LitElement, css, html, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import type { FolderEntry } from '../../shared/types.js';
import { api, ApiError } from '../api.js';
import { errorMessage, t } from '../i18n.js';
import {
  mdiChevronRight,
  mdiClose,
  mdiFolder,
  mdiFolderNetworkOutline,
  mdiFolderPlusOutline,
} from '../icons.js';
import './icon.js';
import { dialogStyles, sharedStyles } from './styles.js';

/**
 * Browses the NAS shared folders (File Station) and fires `pick` with the chosen
 * Download Station path (`video/Films`).
 */
@customElement('dds-folder-picker')
export class DdsFolderPicker extends LitElement {
  @state() private path: string | null = null;
  @state() private folders: FolderEntry[] = [];
  @state() private loading = false;
  @state() private error: string | null = null;
  @state() private creating = false;
  @state() private newName = '';

  @query('dialog') private dialog!: HTMLDialogElement;

  async open(initialPath?: string): Promise<void> {
    await this.updateComplete;
    this.dialog.showModal();
    await this.load(initialPath || null);
    if (this.error && initialPath) await this.load(null);
  }

  private close(): void {
    this.dialog.close();
  }

  private async load(path: string | null): Promise<void> {
    this.loading = true;
    this.error = null;
    this.creating = false;
    try {
      const listing = await api.folders(path ?? undefined);
      this.path = listing.path;
      this.folders = listing.folders;
    } catch (error) {
      const info = error instanceof ApiError ? error.info : undefined;
      this.error = [t('picker.error'), info && errorMessage(info.code), info?.message]
        .filter(Boolean)
        .join(' ');
    } finally {
      this.loading = false;
    }
  }

  private pick(): void {
    if (!this.path) return;
    this.dispatchEvent(new CustomEvent('pick', { detail: this.path }));
    this.close();
  }

  private async createFolder(event: Event): Promise<void> {
    event.preventDefault();
    const name = this.newName.trim();
    if (!this.path || !name) return;
    try {
      const folder = await api.createFolder(this.path, name);
      this.newName = '';
      await this.load(folder.path);
    } catch (error) {
      this.error = errorMessage(error instanceof ApiError ? error.info.code : 'internal');
    }
  }

  override render() {
    const parts = this.path ? this.path.split('/') : [];
    return html`
      <dialog @close=${() => (this.creating = false)}>
        <div class="dialog-head">
          <h2>${t('picker.title')}</h2>
          <button class="icon-btn" aria-label=${t('common.close')} @click=${this.close}>
            <dds-icon .path=${mdiClose}></dds-icon>
          </button>
        </div>

        <nav class="crumbs">
          <button @click=${() => this.load(null)}>${t('picker.shares')}</button>
          ${parts.map(
            (part, index) => html`
              <dds-icon .path=${mdiChevronRight}></dds-icon>
              <button @click=${() => this.load(parts.slice(0, index + 1).join('/'))}>
                ${part}
              </button>
            `,
          )}
        </nav>

        <div class="dialog-body list">
          ${
            this.loading
              ? html`<div class="center"><span class="spinner"></span></div>`
              : this.error
                ? html`<p class="error-box">${this.error}</p>`
                : this.folders.length
                  ? this.folders.map(
                      (folder) =>
                        html`<button class="folder" @click=${() => this.load(folder.path)}>
                          <dds-icon
                            .path=${this.path ? mdiFolder : mdiFolderNetworkOutline}
                          ></dds-icon>
                          <span class="ellipsis">${folder.name}</span>
                          <dds-icon class="go" .path=${mdiChevronRight}></dds-icon>
                        </button>`,
                    )
                  : html`<p class="center muted">${t('picker.empty')}</p>`
          }
          ${
            this.path && this.creating
              ? html`<form class="create" @submit=${this.createFolder}>
                  <input
                    class="input"
                    placeholder=${t('picker.newFolderName')}
                    .value=${this.newName}
                    @input=${(event: InputEvent) => {
                      this.newName = (event.target as HTMLInputElement).value;
                    }}
                  />
                  <button class="btn" ?disabled=${!this.newName.trim()}>
                    ${t('picker.create')}
                  </button>
                </form>`
              : nothing
          }
        </div>

        <div class="dialog-foot">
          ${
            this.path && !this.creating
              ? html`<button class="btn btn-ghost" @click=${() => (this.creating = true)}>
                  <dds-icon .path=${mdiFolderPlusOutline}></dds-icon>${t('picker.newFolder')}
                </button>`
              : nothing
          }
          <span class="spacer"></span>
          <button class="btn btn-primary" ?disabled=${!this.path} @click=${this.pick}>
            ${t('picker.choose')}
          </button>
        </div>
      </dialog>
    `;
  }

  static override styles = [
    sharedStyles,
    dialogStyles,
    css`
      dialog {
        height: min(640px, calc(100dvh - 48px));
      }

      .crumbs {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 2px;
        padding: 0 16px 8px;
        font-size: 14px;
      }

      .crumbs button {
        padding: 6px 6px;
        border: none;
        border-radius: 8px;
        font: inherit;
        font-weight: 600;
        color: var(--accent);
        background: none;
        cursor: pointer;
      }

      .crumbs button:last-child {
        color: var(--text);
      }

      .crumbs button:hover {
        background: var(--accent-soft);
      }

      .crumbs dds-icon {
        --icon-size: 16px;
        color: var(--text-3);
      }

      .list {
        flex: 1;
        align-content: start;
        gap: 4px;
        padding-top: 0;
      }

      .folder {
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 52px;
        padding: 0 12px;
        border: none;
        border-radius: 12px;
        font: inherit;
        text-align: left;
        color: var(--text);
        background: none;
        cursor: pointer;
      }

      .folder:hover {
        background: var(--surface-2);
      }

      .folder dds-icon {
        color: var(--accent);
      }

      .folder span {
        flex: 1;
      }

      .folder .go {
        --icon-size: 20px;
        color: var(--text-3);
      }

      .center {
        display: grid;
        place-items: center;
        padding: 32px 0;
        text-align: center;
      }

      .create {
        display: flex;
        gap: 8px;
        margin-top: 8px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'dds-folder-picker': DdsFolderPicker;
  }
}
