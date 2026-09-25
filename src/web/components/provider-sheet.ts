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
  mdiCheck,
  mdiCheckCircleOutline,
  mdiEyeOffOutline,
  mdiEyeOutline,
  mdiOpenInNew,
} from '../icons.js';
import { store, StoreController } from '../store.js';
import { confirmAction } from './confirm.js';
import { inlineInputStyles } from './folder-picker.js';
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
    const result = await api.testProvider(id, apiKey);
    return result.ok
      ? { status: 'ok', account: result.account }
      : { status: 'error', error: result.error };
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
  /** Key that `check` is about; null for the saved key. */
  @state() private checkedKey: string | null = null;
  @state() private saving = false;
  @state() private working = false;
  @state() private error = '';

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
    this.error = '';
    this.checkRun++;
    const configured = this.providerState?.configured ?? false;
    this.check = configured && known && known.status !== 'checking' ? known : null;
    this.checkedKey = null;
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

  /**
   * Tests the typed key, or the saved one. Resolves to the result, or null when it no longer
   * matters (sheet closed or reopened meanwhile).
   */
  private async test(): Promise<ProviderCheck | null> {
    const id = this.provider;
    const key = this.key.trim();
    const run = ++this.checkRun;
    this.check = { status: 'checking' };
    this.checkedKey = key || null;
    const check = await checkProvider(id, key || undefined);
    if (run !== this.checkRun) return null;
    this.check = check;
    if (!key) this.emitCheck(id, check);
    return check;
  }

  /** The typed key was tested and refused: saving it takes a second press. */
  private get keyRefused(): boolean {
    const key = this.key.trim();
    return !!key && this.checkedKey === key && this.check?.status === 'error';
  }

  private async save(): Promise<void> {
    const id = this.provider;
    const key = this.key.trim();
    if (!key || this.saving) return;
    this.saving = true;
    this.error = '';
    try {
      // A refused key would only show up at the first download: it is tested first.
      let check = this.checkedKey === key ? this.check : null;
      if (!check || check.status === 'checking') {
        check = await this.test();
        if (!check) return;
        if (check.status === 'error') {
          // The reason shows in the account section; the button now reads « Enregistrer quand même ».
          this.error = t('provider.notValidated');
          return;
        }
      }
      store.setSettings(await api.updateSettings({ apiKeys: { [id]: key } }));
      this.emitCheck(id, check);
      store.toast(t('provider.saved'), 'success');
      this.sheet.close();
    } catch (error) {
      this.error = errorMessage(errorInfo(error).code);
    } finally {
      this.saving = false;
    }
  }

  private async makeDefault(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.checked) return;
    this.working = true;
    this.error = '';
    try {
      store.setSettings(await api.updateSettings({ defaultProvider: this.provider }));
    } catch (error) {
      input.checked = false;
      this.error = errorMessage(errorInfo(error).code);
    } finally {
      this.working = false;
    }
  }

  private async removeKey(): Promise<void> {
    const id = this.provider;
    const name = PROVIDERS[id].name;
    const confirmed = await confirmAction({
      title: t('provider.removeTitle', { name }),
      message: t('provider.removeMessage', { name }),
      confirmLabel: t('provider.remove'),
    });
    if (!confirmed) return;
    this.working = true;
    this.error = '';
    try {
      store.setSettings(await api.updateSettings({ apiKeys: { [id]: null } }));
      this.emitCheck(id, null);
      store.toast(t('provider.removed'), 'success');
      this.sheet.close();
    } catch (error) {
      this.error = errorMessage(errorInfo(error).code);
    } finally {
      this.working = false;
    }
  }

  private onClosed(): void {
    // Does not keep a typed key around.
    this.key = '';
    this.reveal = false;
    this.error = '';
    this.checkedKey = null;
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
        primaryLabel=${fromEnv ? '' : this.keyRefused ? t('provider.saveAnyway') : t('provider.save')}
        ?primaryDisabled=${!this.key.trim() || this.working}
        ?busy=${this.saving}
        .error=${this.error}
        @dds-primary=${this.save}
        @dds-closed=${this.onClosed}
      >
        ${
          this.check || fromEnv
            ? html`<section class="section">
                <h3 class="section-header">${t('provider.account')}</h3>
                ${this.check ? html`<div class="group">${this.renderCheck(this.check)}</div>` : nothing}
                ${fromEnv ? html`<p class="section-footer">${this.renderFromEnv()}</p>` : nothing}
              </section>`
            : nothing
        }
        ${fromEnv ? nothing : this.renderKey(configured)}
        ${
          configured && configuredCount >= 2
            ? html`<section class="section">
                <div class="group">${this.renderDefault(isDefault)}</div>
              </section>`
            : nothing
        }
        ${
          configured && !fromEnv
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
            : nothing
        }
      </dds-sheet>
    `;
  }

  /** The default service shows a check: another service is made the default from its own sheet. */
  private renderDefault(isDefault: boolean) {
    if (isDefault) {
      return html`<div class="row">
        <span class="row-main"><span class="row-title">${t('provider.default')}</span></span>
        <dds-icon class="check" .path=${mdiCheck}></dds-icon>
      </div>`;
    }
    return html`<label class="row">
      <span class="row-main"><span class="row-title">${t('provider.default')}</span></span>
      <input
        type="checkbox"
        class="switch"
        role="switch"
        .checked=${live(false)}
        ?disabled=${this.working}
        @change=${this.makeDefault}
      />
    </label>`;
  }

  private renderCheck(check: ProviderCheck) {
    if (check.status === 'checking') {
      return html`<div class="row status checking" role="status">
        <span class="status-icon"><span class="spinner"></span></span>
        <span class="row-main"
          ><span class="row-title secondary">${t('provider.checking')}</span></span
        >
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
        ${
          raw && raw !== check.error.code
            ? html`<span class="row-subtitle wrap">${t('common.detail', { message: raw })}</span>`
            : nothing
        }
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
            @input=${(event: Event) => {
              this.key = (event.target as HTMLInputElement).value;
              this.error = '';
            }}
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
    inlineInputStyles,
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
      }

      .status-icon .spinner {
        color: var(--text-secondary);
      }

      .status .row-main {
        align-self: center;
      }

      .status.checking {
        align-items: center;
      }

      .status.checking .status-icon {
        margin-top: 0;
      }

      .status .row-subtitle {
        overflow-wrap: anywhere;
      }

      .key {
        padding-top: 4px;
        padding-bottom: 4px;
        padding-right: 6px;
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
