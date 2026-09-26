import { LitElement, css, html, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import type { ErrorInfo } from '../../shared/types.js';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { mdiAlertCircleOutline, mdiCheckCircleOutline } from '../icons.js';
import { describeNasError, isHttps } from '../nas.js';
import { store } from '../store.js';
import { inlineInputStyles } from './folder-picker.js';
import './icon.js';
import { errorInfo } from './provider-sheet.js';
import type { DdsSheet } from './sheet.js';
import './sheet.js';
import { sharedStyles } from './styles.js';

/** State of the connection to Download Station. */
export type NasCheck =
  { status: 'checking' } | { status: 'ok' } | { status: 'error'; error: ErrorInfo };

/** Checks that Download Station answers with the saved login. */
export async function checkNas(): Promise<NasCheck> {
  try {
    const result = await api.testNas();
    return result.ok ? { status: 'ok' } : { status: 'error', error: result.error };
  } catch (error) {
    return { status: 'error', error: errorInfo(error) };
  }
}

type Field = 'url' | 'account' | 'password' | 'otp';

/**
 * Connection to Download Station: NAS address and DSM account. A change is saved once DSM
 * accepts it, so the password is asked each time.
 *
 * Fires `dds-nas-checked` (`CustomEvent<NasCheck>`) once a new connection is saved.
 */
@customElement('dds-nas-sheet')
export class DdsNasSheet extends LitElement {
  @state() private values: Record<Field, string> = { url: '', account: '', password: '', otp: '' };
  @state() private insecureTls = false;
  @state() private needOtp = false;
  @state() private check: NasCheck | null = null;
  @state() private saving = false;
  @state() private error = '';

  @query('dds-sheet') private sheet!: DdsSheet;

  /** Ignores the answer of a check made for a previous opening. */
  private checkRun = 0;

  /** Opens the sheet; `known` is the last check of the connection, when there is one. */
  async open(known?: NasCheck | null): Promise<void> {
    const nas = store.settings?.nas;
    this.values = { url: nas?.url ?? '', account: nas?.account ?? '', password: '', otp: '' };
    this.insecureTls = nas?.insecureTls ?? false;
    this.needOtp = false;
    this.error = '';
    this.checkRun++;
    this.check = known && known.status !== 'checking' ? known : null;
    await this.updateComplete;
    await this.sheet.show();
    if (nas && !this.check) void this.test();
    if (matchMedia('(pointer: fine)').matches) this.focusField(nas ? 'password' : 'url');
  }

  private async test(): Promise<void> {
    const run = ++this.checkRun;
    this.check = { status: 'checking' };
    const check = await checkNas();
    if (run === this.checkRun) this.check = check;
  }

  private set(field: Field, value: string): void {
    this.values = { ...this.values, [field]: value };
    this.error = '';
  }

  private async focusField(field: Field, clear = false): Promise<void> {
    if (clear) this.values = { ...this.values, [field]: '' };
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLInputElement>(`#${field}`)?.focus();
  }

  private get complete(): boolean {
    const { url, account, password } = this.values;
    return !!url.trim() && !!account.trim() && !!password;
  }

  private async save(): Promise<void> {
    if (!this.complete || this.saving) return;
    const { url, account, password, otp } = this.values;
    this.saving = true;
    this.error = '';
    try {
      const result = await api.saveNas({
        url,
        account: account.trim(),
        password,
        insecureTls: isHttps(url) && this.insecureTls,
        ...(this.needOtp && otp.trim() ? { otp } : {}),
      });
      if (result.ok) {
        store.setSettings(result.settings);
        this.checkRun++;
        this.dispatchEvent(
          new CustomEvent<NasCheck>('dds-nas-checked', { detail: { status: 'ok' } }),
        );
        store.toast(t('nas.saved'), 'success');
        this.sheet.close();
        return;
      }
      const { code } = result.error;
      if (code === 'otp_required') {
        this.needOtp = true;
        void this.focusField('otp');
        return;
      }
      const { text, detail } = describeNasError(result.error);
      this.error = detail ? `${text} ${detail}` : text;
      if (code === 'invalid_credentials') void this.focusField('password', true);
      if (code === 'otp_invalid') void this.focusField('otp', true);
    } catch (error) {
      this.error = describeNasError(errorInfo(error)).text;
    } finally {
      this.saving = false;
    }
  }

  private onClosed(): void {
    // Does not keep a typed password around.
    this.values = { ...this.values, password: '', otp: '' };
    this.error = '';
    this.checkRun++;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    void this.save();
  }

  override render() {
    const configured = !!store.settings?.nas;
    return html`
      <dds-sheet
        heading=${t('nas.title')}
        primaryLabel=${t('common.save')}
        ?primaryDisabled=${!this.complete}
        ?busy=${this.saving}
        .error=${this.error}
        @dds-primary=${this.save}
        @dds-closed=${this.onClosed}
      >
        ${
          configured && this.check
            ? html`<section class="section">
                <h3 class="section-header">${t('nas.status')}</h3>
                <div class="group">${this.renderCheck(this.check)}</div>
              </section>`
            : nothing
        }
        <section class="section">
          <h3 class="section-header">${t('nas.connection')}</h3>
          <div class="group">
            ${this.renderField('url', t('nas.url'), t('nas.urlPlaceholder'), {
              type: 'url',
              inputmode: 'url',
            })}
            ${this.renderField('account', t('nas.account'), t('nas.accountPlaceholder'))}
            ${this.renderField('password', t('login.password'), t('nas.passwordPlaceholder'), {
              type: 'password',
            })}
            ${
              this.needOtp
                ? this.renderField('otp', t('nas.code'), t('nas.otp'), {
                    inputmode: 'numeric',
                    autocomplete: 'one-time-code',
                  })
                : nothing
            }
          </div>
          <p class="section-footer">${this.needOtp ? t('nas.otpHint') : t('nas.footer')}</p>
        </section>
        ${isHttps(this.values.url) ? this.renderInsecureTls() : nothing}
      </dds-sheet>
    `;
  }

  private renderField(
    field: Field,
    label: string,
    placeholder: string,
    options: { type?: string; inputmode?: string; autocomplete?: string } = {},
  ) {
    return html`<div class="row field">
      <label for=${field}>${label}</label>
      <input
        id=${field}
        class="inline-input"
        type=${options.type ?? 'text'}
        inputmode=${options.inputmode ?? 'text'}
        placeholder=${placeholder}
        autocomplete=${options.autocomplete ?? 'off'}
        autocapitalize="none"
        autocorrect="off"
        spellcheck="false"
        .value=${live(this.values[field])}
        @input=${(event: Event) => this.set(field, (event.target as HTMLInputElement).value)}
        @keydown=${this.onKeyDown}
      />
    </div>`;
  }

  private renderInsecureTls() {
    return html`<section class="section">
      <div class="group">
        <label class="row">
          <span class="row-main">
            <span class="row-title">${t('nas.insecureTls')}</span>
            <span class="row-subtitle">${t('nas.insecureTlsHint')}</span>
          </span>
          <input
            type="checkbox"
            class="switch"
            role="switch"
            .checked=${live(this.insecureTls)}
            @change=${(event: Event) => {
              this.insecureTls = (event.target as HTMLInputElement).checked;
              this.error = '';
            }}
          />
        </label>
      </div>
    </section>`;
  }

  private renderCheck(check: NasCheck) {
    if (check.status === 'checking') {
      return html`<div class="row status checking" role="status">
        <span class="status-icon"><span class="spinner"></span></span>
        <span class="row-main"
          ><span class="row-title secondary">${t('provider.checking')}</span></span
        >
      </div>`;
    }
    const nas = store.settings?.nas;
    if (check.status === 'ok') {
      return html`<div class="row status" role="status">
        <dds-icon class="status-icon success-text" .path=${mdiCheckCircleOutline}></dds-icon>
        <span class="row-main">
          <span class="row-title wrap">${t('provider.connected')}</span>
          ${nas ? html`<span class="row-subtitle wrap">${nas.account} · ${nas.url}</span>` : nothing}
        </span>
      </div>`;
    }
    const { text, detail } = describeNasError(check.error);
    return html`<div class="row status ${detail ? '' : 'single'}" role="alert">
      <dds-icon class="status-icon danger-text" .path=${mdiAlertCircleOutline}></dds-icon>
      <span class="row-main">
        <span class="row-title danger-text">${text}</span>
        ${detail ? html`<span class="row-subtitle wrap">${detail}</span>` : nothing}
      </span>
    </div>`;
  }

  static override styles = [
    sharedStyles,
    inlineInputStyles,
    css`
      .row:focus-visible {
        box-shadow: inset var(--focus-ring);
      }

      .field {
        padding-top: 4px;
        padding-bottom: 4px;
      }

      /* Same size as the typed text, so that both sit on one line. */
      .field label {
        flex: none;
        width: 7.5em;
        font-size: 16px;
      }

      @media (pointer: fine) {
        .field label {
          font-size: 15px;
        }
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

      .status.checking,
      .status.single {
        align-items: center;
      }

      .status.checking .status-icon,
      .status.single .status-icon {
        margin-top: 0;
      }

      .status .row-subtitle {
        overflow-wrap: anywhere;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'dds-nas-sheet': DdsNasSheet;
  }
}
