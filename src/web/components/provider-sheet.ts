import { LitElement, css, html, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import {
  PROVIDERS,
  type ErrorInfo,
  type ProviderAccount,
  type ProviderId,
  type ProviderState,
} from '../../shared/types.js';
import { api, ApiError } from '../api.js';
import { formatDate } from '../format.js';
import { errorMessage, t } from '../i18n.js';
import {
  mdiAlertCircleOutline,
  mdiCheckCircleOutline,
  mdiEyeOffOutline,
  mdiEyeOutline,
  mdiOpenInNew,
} from '../icons.js';
import { store, StoreController } from '../store.js';
import './icon.js';
import type { DdsSheet } from './sheet.js';
import './sheet.js';
import { sharedStyles } from './styles.js';

/** State of the account check of a provider's API key. */
export type ProviderCheck =
  | { status: 'checking' }
  | { status: 'ok'; account: ProviderAccount }
  | { status: 'error'; error: ErrorInfo };

export interface ProviderCheckedDetail {
  id: ProviderId;
  /** Null once the key has been removed. */
  check: ProviderCheck | null;
}

export const errorInfo = (error: unknown): ErrorInfo =>
  error instanceof ApiError ? error.info : { code: 'internal' };

/** Checks the saved API key of a provider, or the given one. */
export async function checkProvider(id: ProviderId, apiKey?: string): Promise<ProviderCheck> {
  try {
    return { status: 'ok', account: await api.testProvider(id, apiKey) };
  } catch (error) {
    return { status: 'error', error: errorInfo(error) };
  }
}

/** « Premium jusqu’au 14 février 2027 », « Premium » or « Compte gratuit ». */
export function premiumLabel(account: ProviderAccount): string {
  if (!account.premium) return t('provider.notPremium');
  return account.premiumUntil
    ? t('provider.premiumUntil', { date: formatDate(account.premiumUntil) })
    : t('provider.premium');
}

/**
 * API key, account and default flag of one debrid service.
 *
 * Fires `dds-provider-checked` (`ProviderCheckedDetail`) whenever the saved key has been checked,
 * so that the settings page shows the same status.
 */
@customElement('dds-provider-sheet')
export class DdsProviderSheet extends LitElement {
  @state() private provider: ProviderId = 'alldebrid';
  /** Key typed by the user. */
  @state() private key = '';
  @state() private reveal = false;
  @state() private check: ProviderCheck | null = null;
  @state() private saving = false;
  @state() private working = false;

  @query('dds-sheet') private sheet!: DdsSheet;
  @query('#key') private keyInput?: HTMLInputElement;

  /** Ignores the answer of a check made for a previous key or a previous opening. */
  private checkRun = 0;

  constructor() {
    super();
    new StoreController(this);
  }

  private get providerState(): ProviderState | undefined {
    return store.settings?.providers.find((state) => state.id === this.provider);
  }

  /** Opens the sheet; `known` is the last check of the saved key, when there is one. */
  async open(id: ProviderId, known?: ProviderCheck | null): Promise<void> {
    this.provider = id;
    this.key = '';
    this.reveal = false;
    this.checkRun++;
    const configured = this.providerState?.configured ?? false;
    this.check = configured && known && known.status !== 'checking' ? known : null;
    await this.updateComplete;
    await this.sheet.show();
    if (configured && !this.check) void this.test();
    if (!configured && matchMedia('(pointer: fine)').matches) this.keyInput?.focus();
  }

  private emitCheck(id: ProviderId, check: ProviderCheck | null): void {
    this.dispatchEvent(
      new CustomEvent<ProviderCheckedDetail>('dds-provider-checked', { detail: { id, check } }),
    );
  }

  /** Tests the typed key, or the saved one. */
  private async test(): Promise<void> {
    const id = this.provider;
    const key = this.key.trim();
    const run = ++this.checkRun;
    this.check = { status: 'checking' };
    const check = await checkProvider(id, key || undefined);
    if (run !== this.checkRun) return;
    this.check = check;
    if (!key) this.emitCheck(id, check);
  }

  private async save(): Promise<void> {
    const id = this.provider;
    const key = this.key.trim();
    if (!key || this.saving) return;
    this.saving = true;
    try {
      store.setSettings(await api.updateSettings({ apiKeys: { [id]: key } }));
      store.toast(t('settings.saved'), 'success');
      // The new key is checked in the background: the settings page shows the result.
      this.emitCheck(id, { status: 'checking' });
      void checkProvider(id).then((check) => this.emitCheck(id, check));
      this.sheet.close();
    } catch (error) {
      store.toast(errorMessage(errorInfo(error).code), 'error');
    } finally {
      this.saving = false;
    }
  }

  private async makeDefault(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.checked) return;
    this.working = true;
    try {
      store.setSettings(await api.updateSettings({ defaultProvider: this.provider }));
    } catch (error) {
      input.checked = false;
      store.toast(errorMessage(errorInfo(error).code), 'error');
    } finally {
      this.working = false;
    }
  }

  private async removeKey(): Promise<void> {
    const id = this.provider;
    if (!confirm(t('provider.removeConfirm', { name: PROVIDERS[id].name }))) return;
    this.working = true;
    try {
      store.setSettings(await api.updateSettings({ apiKeys: { [id]: null } }));
      this.emitCheck(id, null);
      store.toast(t('settings.saved'), 'success');
      this.sheet.close();
    } catch (error) {
      store.toast(errorMessage(errorInfo(error).code), 'error');
    } finally {
      this.working = false;
    }
  }

  private onClosed(): void {
    // Does not keep a typed key around.
    this.key = '';
    this.reveal = false;
    this.checkRun++;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    void this.save();
  }

  override render() {
    const provider = PROVIDERS[this.provider];
    const configured = this.providerState?.configured ?? false;
    const fromEnv = this.providerState?.fromEnv ?? false;
    const configuredCount = store.settings?.providers.filter((p) => p.configured).length ?? 0;
    const isDefault = store.settings?.defaultProvider === this.provider;

    return html`
      <dds-sheet
        heading=${provider.name}
        primaryLabel=${fromEnv ? '' : t('provider.save')}
        ?primaryDisabled=${!this.key.trim() || this.working}
        ?busy=${this.saving}
        @dds-primary=${this.save}
        @dds-closed=${this.onClosed}
      >
        ${this.check || fromEnv
          ? html`<section class="section">
              <h3 class="section-header">${t('provider.account')}</h3>
              ${this.check ? html`<div class="group">${this.renderCheck(this.check)}</div>` : nothing}
              ${fromEnv ? html`<p class="section-footer">${this.renderFromEnv()}</p>` : nothing}
            </section>`
          : nothing}
        ${fromEnv ? nothing : this.renderKey(configured)}
        ${configured && configuredCount >= 2
          ? html`<section class="section">
              <div class="group">
                <label class="row ${isDefault ? 'locked' : ''}">
                  <span class="row-main"><span class="row-title">${t('provider.default')}</span></span>
                  <input
                    type="checkbox"
                    class="switch"
                    role="switch"
                    .checked=${live(isDefault)}
                    ?disabled=${isDefault || this.working}
                    @change=${this.makeDefault}
                  />
                </label>
              </div>
            </section>`
          : nothing}
        ${configured && !fromEnv
          ? html`<section class="section">
              <div class="group">
                <button
                  class="row destructive"
                  ?disabled=${this.working || this.saving}
                  @click=${this.removeKey}
                >
                  ${t('provider.remove')}
                </button>
              </div>
            </section>`
          : nothing}
      </dds-sheet>
    `;
  }

  private renderCheck(check: ProviderCheck) {
    if (check.status === 'checking') {
      return html`<div class="row status" role="status">
        <span class="status-icon"><span class="spinner"></span></span>
        <span class="row-main"><span class="row-title secondary">${t('provider.checking')}</span></span>
      </div>`;
    }
    if (check.status === 'ok') {
      return html`<div class="row status" role="status">
        <dds-icon class="status-icon success-text" .path=${mdiCheckCircleOutline}></dds-icon>
        <span class="row-main">
          <span class="row-title wrap">${check.account.username}</span>
          <span class="row-subtitle">${premiumLabel(check.account)}</span>
        </span>
      </div>`;
    }
    const raw = check.error.message;
    return html`<div class="row status" role="alert">
      <dds-icon class="status-icon danger-text" .path=${mdiAlertCircleOutline}></dds-icon>
      <span class="row-main">
        <span class="row-title danger-text">${errorMessage(check.error.code)}</span>
        ${raw && raw !== check.error.code
          ? html`<span class="row-subtitle wrap">${raw}</span>`
          : nothing}
      </span>
    </div>`;
  }

  /** The variable name is shown in monospace. */
  private renderFromEnv() {
    const name = `${this.provider.toUpperCase()}_API_KEY`;
    const [before, after = ''] = t('provider.fromEnv', { name: '\u0000' }).split('\u0000');
    return html`${before}<code>${name}</code>${after}`;
  }

  private renderKey(configured: boolean) {
    const provider = PROVIDERS[this.provider];
    const testing = this.check?.status === 'checking';
    return html`<section class="section">
      <h3 class="section-header"><label for="key">${t('provider.apiKey')}</label></h3>
      <div class="group">
        <div class="row key">
          <input
            id="key"
            class="inline-input mono-input"
            type=${this.reveal ? 'text' : 'password'}
            .value=${live(this.key)}
            placeholder=${t('provider.apiKeyPlaceholder')}
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            @input=${(event: Event) => (this.key = (event.target as HTMLInputElement).value)}
            @keydown=${this.onKeyDown}
          />
          <button
            class="icon-btn"
            aria-label=${this.reveal ? t('provider.hide') : t('provider.show')}
            @click=${() => (this.reveal = !this.reveal)}
          >
            <dds-icon .path=${this.reveal ? mdiEyeOffOutline : mdiEyeOutline}></dds-icon>
          </button>
        </div>
      </div>
      ${configured ? html`<p class="section-footer">${t('provider.replaceHint')}</p>` : nothing}
      <div class="actions">
        <button
          class="btn"
          ?disabled=${testing || (!configured && !this.key.trim())}
          @click=${this.test}
        >
          ${t('provider.test')}
        </button>
        <a class="btn btn-plain" href=${provider.apiKeyUrl} target="_blank" rel="noreferrer">
          ${t('provider.getKey')}<dds-icon .path=${mdiOpenInNew}></dds-icon>
        </a>
      </div>
    </section>`;
  }

  static override styles = [
    sharedStyles,
    css`
      .row:focus-visible {
        box-shadow: inset var(--focus-ring);
      }

      .status {
        align-items: flex-start;
      }

      .status-icon {
        --icon-size: 22px;
        display: grid;
        flex: none;
        place-items: center;
        width: 22px;
        height: 22px;
        margin-top: -1px;
        color: var(--text-secondary);
      }

      .status .row-main {
        align-self: center;
      }

      .status .row-subtitle {
        overflow-wrap: anywhere;
      }

      .key {
        padding-top: 4px;
        padding-bottom: 4px;
        padding-right: 6px;
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
        font-family: var(--font);
        color: var(--text-tertiary);
      }

      .mono-input {
        font-family: var(--font-mono);
      }

      @media (pointer: fine) {
        .inline-input {
          font-size: 15px;
        }
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        margin-top: 12px;
      }

      a.btn:hover {
        text-decoration: none;
      }

      .actions a dds-icon {
        --icon-size: 16px;
      }

      label.row.locked {
        cursor: default;
      }

      label.row.locked:hover {
        background: transparent;
      }

      code {
        font-family: var(--font-mono);
        font-size: 0.95em;
        overflow-wrap: anywhere;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'dds-provider-sheet': DdsProviderSheet;
  }
}
