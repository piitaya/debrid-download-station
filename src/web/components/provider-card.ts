import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { PROVIDERS, type ProviderAccount, type ProviderState } from '../../shared/types.js';
import { api, ApiError } from '../api.js';
import { formatDate } from '../format.js';
import { errorMessage, t } from '../i18n.js';
import {
  mdiAlertCircleOutline,
  mdiCheckCircle,
  mdiEyeOffOutline,
  mdiEyeOutline,
  mdiOpenInNew,
  mdiStar,
  mdiStarOutline,
} from '../icons.js';
import { store } from '../store.js';
import './icon.js';
import { sharedStyles } from './styles.js';

type Check =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok'; account: ProviderAccount }
  | { state: 'error'; message: string };

@customElement('dds-provider-card')
export class DdsProviderCard extends LitElement {
  @property({ attribute: false }) provider!: ProviderState;
  @property({ type: Boolean }) isDefault = false;
  @property({ type: Boolean }) canBeDefault = false;

  @state() private key = '';
  @state() private reveal = false;
  @state() private busy = false;
  @state() private check: Check = { state: 'idle' };

  override firstUpdated(): void {
    if (this.provider.configured) void this.test();
  }

  private async test(): Promise<void> {
    this.check = { state: 'checking' };
    try {
      const account = await api.testProvider(this.provider.id, this.key.trim() || undefined);
      this.check = { state: 'ok', account };
    } catch (error) {
      const info = error instanceof ApiError ? error.info : undefined;
      this.check = {
        state: 'error',
        message: [errorMessage(info?.code), info?.message].filter(Boolean).join(' — '),
      };
    }
  }

  private async save(value: string | null): Promise<void> {
    this.busy = true;
    try {
      const settings = await api.updateSettings({ apiKeys: { [this.provider.id]: value } });
      store.setSettings(settings);
      store.toast(t('settings.saved'), 'success');
      this.key = '';
      this.check = { state: 'idle' };
      if (value) await this.test();
    } catch (error) {
      store.toast(errorMessage(error instanceof ApiError ? error.info.code : 'internal'), 'error');
    } finally {
      this.busy = false;
    }
  }

  private async makeDefault(): Promise<void> {
    try {
      store.setSettings(await api.updateSettings({ defaultProvider: this.provider.id }));
    } catch (error) {
      store.toast(errorMessage(error instanceof ApiError ? error.info.code : 'internal'), 'error');
    }
  }

  private renderStatus() {
    const check = this.check;
    if (check.state === 'checking') {
      return html`<span class="badge"
        ><span class="spinner mini"></span>${t('provider.checking')}</span
      >`;
    }
    if (check.state === 'ok') {
      return html`<span class="badge success"
        ><dds-icon .path=${mdiCheckCircle}></dds-icon>${t('provider.connected')}</span
      >`;
    }
    if (check.state === 'error') {
      return html`<span class="badge danger"
        ><dds-icon .path=${mdiAlertCircleOutline}></dds-icon>${t('status.error')}</span
      >`;
    }
    return this.provider.configured
      ? nothing
      : html`<span class="badge">${t('provider.notConfigured')}</span>`;
  }

  private renderAccount() {
    const check = this.check;
    if (check.state === 'error') return html`<p class="small error">${check.message}</p>`;
    if (check.state !== 'ok') return nothing;
    const { account } = check;
    const premium = account.premium
      ? account.premiumUntil
        ? t('provider.premiumUntil', { date: formatDate(account.premiumUntil) })
        : t('provider.premium')
      : t('provider.notPremium');
    return html`<p class="small muted">
      <strong>${account.username}</strong> ·
      <span class=${account.premium ? '' : 'warn'}>${premium}</span>
    </p>`;
  }

  override render() {
    const { id, configured, fromEnv } = this.provider;
    const info = PROVIDERS[id];
    const envName = `${id.toUpperCase()}_API_KEY`;

    return html`
      <div class="provider">
        <div class="top">
          <h3>${info.name}</h3>
          ${this.renderStatus()}
          <span class="spacer"></span>
          ${
            configured && this.canBeDefault
              ? html`<button
                  class="icon-btn star ${this.isDefault ? 'on' : ''}"
                  title=${this.isDefault ? t('provider.default') : t('settings.makeDefault')}
                  aria-label=${this.isDefault ? t('provider.default') : t('settings.makeDefault')}
                  aria-pressed=${this.isDefault}
                  @click=${this.makeDefault}
                >
                  <dds-icon .path=${this.isDefault ? mdiStar : mdiStarOutline}></dds-icon>
                </button>`
              : nothing
          }
        </div>
        ${this.renderAccount()}
        ${
          fromEnv
            ? html`<p class="small muted">${t('provider.fromEnv', { name: envName })}</p>`
            : html`
                <div class="key-row">
                  <div class="key-input">
                    <input
                      class="input mono"
                      type=${this.reveal ? 'text' : 'password'}
                      placeholder=${configured ? '••••••••••••••••' : t('provider.apiKey')}
                      aria-label=${t('provider.apiKey')}
                      autocomplete="off"
                      autocapitalize="none"
                      spellcheck="false"
                      .value=${this.key}
                      @input=${(event: InputEvent) => {
                        this.key = (event.target as HTMLInputElement).value;
                      }}
                    />
                    <button
                      class="icon-btn reveal"
                      type="button"
                      aria-label=${this.reveal ? t('provider.hide') : t('provider.show')}
                      @click=${() => (this.reveal = !this.reveal)}
                    >
                      <dds-icon .path=${this.reveal ? mdiEyeOffOutline : mdiEyeOutline}></dds-icon>
                    </button>
                  </div>
                </div>
                <div class="buttons">
                  <a class="get-key small" href=${info.apiKeyUrl} target="_blank" rel="noreferrer">
                    ${t('provider.getKey')}<dds-icon .path=${mdiOpenInNew}></dds-icon>
                  </a>
                  <span class="spacer"></span>
                  ${
                    configured && !this.key.trim()
                      ? html`<button
                          class="btn btn-sm btn-ghost"
                          ?disabled=${this.busy}
                          @click=${() => this.save(null)}
                        >
                          ${t('provider.remove')}
                        </button>`
                      : nothing
                  }
                  ${
                    configured || this.key.trim()
                      ? html`<button class="btn btn-sm" ?disabled=${this.busy} @click=${this.test}>
                          ${t('provider.test')}
                        </button>`
                      : nothing
                  }
                  ${
                    this.key.trim()
                      ? html`<button
                          class="btn btn-sm btn-primary"
                          ?disabled=${this.busy}
                          @click=${() => this.save(this.key.trim())}
                        >
                          ${t('provider.save')}
                        </button>`
                      : nothing
                  }
                </div>
              `
        }
      </div>
    `;
  }

  static override styles = [
    sharedStyles,
    css`
      .provider {
        display: grid;
        gap: 10px;
      }

      .top {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 36px;
      }

      h3 {
        font-size: 17px;
        font-weight: 700;
      }

      .spacer {
        flex: 1;
      }

      .spinner.mini {
        width: 12px;
        height: 12px;
        border-width: 2px;
      }

      .star {
        width: 36px;
        height: 36px;
        margin-right: -6px;
      }

      .star.on {
        color: #f59e0b;
      }

      .error {
        color: var(--danger);
      }

      .warn {
        color: var(--warning);
      }

      .key-input {
        position: relative;
      }

      .key-input .input {
        padding-right: 52px;
      }

      .reveal {
        position: absolute;
        top: 2px;
        right: 2px;
      }

      .reveal dds-icon {
        --icon-size: 20px;
      }

      .buttons {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }

      .get-key {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-weight: 500;
      }

      .get-key dds-icon {
        --icon-size: 14px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'dds-provider-card': DdsProviderCard;
  }
}
