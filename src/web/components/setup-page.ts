import { LitElement, css, html, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { MIN_PASSWORD_LENGTH, type SetupResult } from '../../shared/types.js';
import { ApiError } from '../api.js';
import { errorMessage, t } from '../i18n.js';
import { mdiAlertCircleOutline } from '../icons.js';
import { describeNasError, guessNasUrl, isHttps } from '../nas.js';
import { store } from '../store.js';
import { authStyles } from './auth-styles.js';
import './icon.js';
import './logo.js';
import { sharedStyles } from './styles.js';

type Field = 'username' | 'password' | 'confirm' | 'url' | 'account' | 'nasPassword' | 'otp';

/**
 * First start: creates the app's account, then connects Download Station. Both are sent at
 * the end, as the server only creates the account with a DSM login that works.
 */
@customElement('dds-setup-page')
export class DdsSetupPage extends LitElement {
  @state() private step: 1 | 2 = 1;
  @state() private values: Record<Field, string> = {
    username: '',
    password: '',
    confirm: '',
    url: guessNasUrl(),
    account: '',
    nasPassword: '',
    otp: '',
  };
  @state() private insecureTls = false;
  @state() private needOtp = false;
  @state() private busy = false;
  @state() private error: { text: string; detail: string } | null = null;

  @query('form') private form!: HTMLFormElement;

  private set(field: Field, value: string): void {
    this.values = { ...this.values, [field]: value };
  }

  private async focusField(field: Field, clear = false): Promise<void> {
    if (clear) this.set(field, '');
    await this.updateComplete;
    this.form.querySelector<HTMLInputElement>(`[name="${field}"]`)?.focus();
  }

  private next(): void {
    const { username, password, confirm } = this.values;
    if (!username.trim()) return void this.focusField('username');
    if (password.length < MIN_PASSWORD_LENGTH) {
      this.error = { text: errorMessage('weak_password'), detail: '' };
      return void this.focusField('password');
    }
    if (password !== confirm) {
      this.error = { text: t('welcome.mismatch'), detail: '' };
      return void this.focusField('confirm', true);
    }
    this.error = null;
    this.step = 2;
    void this.focusField(this.values.url ? 'account' : 'url');
  }

  private back(): void {
    this.error = null;
    this.step = 1;
  }

  private async finish(): Promise<void> {
    const { username, password, url, account, nasPassword, otp } = this.values;
    if (!url.trim() || !account.trim() || !nasPassword) {
      return void this.focusField(
        !url.trim() ? 'url' : !account.trim() ? 'account' : 'nasPassword',
      );
    }
    this.busy = true;
    this.error = null;
    let result: SetupResult;
    try {
      result = await store.setup({
        username: username.trim(),
        password,
        nas: {
          url,
          account: account.trim(),
          password: nasPassword,
          insecureTls: isHttps(url) && this.insecureTls,
          ...(this.needOtp && otp.trim() ? { otp } : {}),
        },
      });
    } catch (error) {
      result = {
        ok: false,
        error: error instanceof ApiError ? error.info : { code: 'internal' },
      };
    } finally {
      this.busy = false;
    }
    // Signed in: the app takes over.
    if (result.ok) return;

    const { code } = result.error;
    if (code === 'otp_required') {
      this.needOtp = true;
      return void this.focusField('otp');
    }
    this.error = describeNasError(result.error);
    if (code === 'weak_password') this.step = 1;
    else if (code === 'otp_invalid') void this.focusField('otp', true);
    else if (code === 'invalid_credentials') void this.focusField('nasPassword', true);
  }

  private submit(event: SubmitEvent): void {
    event.preventDefault();
    if (this.busy) return;
    if (this.step === 1) this.next();
    else void this.finish();
  }

  override render() {
    return html`
      <main>
        <form @submit=${this.submit} novalidate>
          ${this.step === 1 ? this.renderAccount() : this.renderNas()}
        </form>
      </main>
    `;
  }

  private renderHeader(title: string, hint: string) {
    return html`<header>
      <dds-logo size="56"></dds-logo>
      <p class="step small secondary">${t('welcome.step', { step: this.step })}</p>
      <h1>${title}</h1>
      <p class="secondary">${hint}</p>
    </header>`;
  }

  private input(
    field: Field,
    placeholder: string,
    options: { type?: string; autocomplete?: string; inputmode?: string; className?: string } = {},
  ) {
    return html`<input
      name=${field}
      class=${options.className ?? ''}
      type=${options.type ?? 'text'}
      inputmode=${options.inputmode ?? 'text'}
      placeholder=${placeholder}
      aria-label=${placeholder}
      autocomplete=${options.autocomplete ?? 'off'}
      autocapitalize="none"
      autocorrect="off"
      spellcheck="false"
      .value=${live(this.values[field])}
      ?disabled=${this.busy}
      @input=${(event: Event) => this.set(field, (event.target as HTMLInputElement).value)}
    />`;
  }

  private renderAccount() {
    return html`
      ${this.renderHeader(t('welcome.account'), t('welcome.accountHint'))}
      <div class="group fields">
        ${this.input('username', t('login.username'), { autocomplete: 'username' })}
        ${this.input('password', t('login.password'), {
          type: 'password',
          autocomplete: 'new-password',
        })}
        ${this.input('confirm', t('welcome.confirm'), {
          type: 'password',
          autocomplete: 'new-password',
        })}
      </div>
      <p class="hint small secondary">${t('welcome.passwordRule')}</p>
      ${this.renderError()}
      <button class="btn btn-primary btn-block submit">${t('welcome.continue')}</button>
    `;
  }

  private renderNas() {
    const https = isHttps(this.values.url);
    return html`
      ${this.renderHeader(t('welcome.nas'), t('welcome.nasHint'))}
      <div class="group fields">
        ${this.input('url', t('nas.urlPlaceholder'), { type: 'url', inputmode: 'url' })}
        ${this.input('account', t('nas.account'))}
        ${this.input('nasPassword', t('nas.password'), { type: 'password' })}
        ${
          this.needOtp
            ? this.input('otp', t('nas.otp'), {
                inputmode: 'numeric',
                autocomplete: 'one-time-code',
                className: 'otp',
              })
            : nothing
        }
      </div>
      ${
        this.needOtp
          ? html`<p class="hint small secondary">${t('nas.otpHint')}</p>`
          : html`<p class="hint small secondary">${t('nas.urlHint')}</p>`
      }
      ${
        https
          ? html`<div class="group">
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
                  ?disabled=${this.busy}
                  @change=${(event: Event) =>
                    (this.insecureTls = (event.target as HTMLInputElement).checked)}
                />
              </label>
            </div>`
          : nothing
      }
      ${this.renderError()}
      <button class="btn btn-primary btn-block submit" ?disabled=${this.busy}>
        ${this.busy ? html`<span class="spinner"></span>` : t('welcome.finish')}
      </button>
      <button type="button" class="btn btn-plain link" ?disabled=${this.busy} @click=${this.back}>
        ${t('nav.back')}
      </button>
    `;
  }

  private renderError() {
    if (!this.error) return nothing;
    const { text, detail } = this.error;
    return html`<div class="notice" role="alert">
      <dds-icon .path=${mdiAlertCircleOutline}></dds-icon>
      <div class="notice-text">
        <p>${text}</p>
        ${detail ? html`<p class="raw">${detail}</p>` : nothing}
      </div>
    </div>`;
  }

  static override styles = [
    sharedStyles,
    authStyles,
    css`
      .step {
        font-weight: 600;
      }

      .notice-text {
        display: grid;
        gap: 2px;
        min-width: 0;
      }

      .notice .raw {
        font-size: 12px;
        color: var(--text-secondary);
        overflow-wrap: anywhere;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'dds-setup-page': DdsSetupPage;
  }
}
