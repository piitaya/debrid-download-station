import { LitElement, css, html, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { ApiError } from '../api.js';
import { errorMessage, t } from '../i18n.js';
import { mdiAlertCircleOutline } from '../icons.js';
import { store } from '../store.js';
import './icon.js';
import './logo.js';
import { sharedStyles } from './styles.js';

@customElement('dds-login-page')
export class DdsLoginPage extends LitElement {
  @state() private needOtp = false;
  @state() private busy = false;
  @state() private error: string | null = store.logoutReason
    ? errorMessage(store.logoutReason)
    : null;

  @query('input[name="otp"]') private otpInput?: HTMLInputElement;

  private async submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const data = new FormData(event.target as HTMLFormElement);
    const username = String(data.get('username') ?? '').trim();
    const password = String(data.get('password') ?? '');
    const otp = String(data.get('otp') ?? '').trim() || undefined;
    if (!username || !password) return;

    this.busy = true;
    this.error = null;
    try {
      await store.login(username, password, otp);
    } catch (error) {
      const code = error instanceof ApiError ? error.info.code : 'internal';
      if (code === 'otp_required') {
        this.needOtp = true;
        await this.updateComplete;
        this.otpInput?.focus();
      } else {
        this.error = errorMessage(code);
        if (code === 'otp_invalid' && this.otpInput) {
          this.otpInput.value = '';
          this.otpInput.focus();
        }
      }
    } finally {
      this.busy = false;
    }
  }

  override render() {
    return html`
      <main>
        <form @submit=${this.submit}>
          <header>
            <dds-logo size="56"></dds-logo>
            <h1>${t('app.name')}</h1>
            <p class="secondary">${t('login.subtitle')}</p>
          </header>

          <div class="group fields">
            <input
              name="username"
              placeholder=${t('login.username')}
              aria-label=${t('login.username')}
              autocomplete="username"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
              required
              ?disabled=${this.busy}
            />
            <input
              name="password"
              type="password"
              placeholder=${t('login.password')}
              aria-label=${t('login.password')}
              autocomplete="current-password"
              required
              ?disabled=${this.busy}
            />
            ${
              this.needOtp
                ? html`<input
                    name="otp"
                    class="otp"
                    placeholder=${t('login.otp')}
                    aria-label=${t('login.otp')}
                    inputmode="numeric"
                    autocomplete="one-time-code"
                    pattern="[0-9 ]*"
                    maxlength="8"
                    required
                    ?disabled=${this.busy}
                  />`
                : nothing
            }
          </div>
          ${this.needOtp ? html`<p class="hint small secondary">${t('login.otpHint')}</p>` : nothing}
          ${
            this.error
              ? html`<div class="notice" role="alert">
                  <dds-icon .path=${mdiAlertCircleOutline}></dds-icon>
                  <span>${this.error}</span>
                </div>`
              : nothing
          }

          <button class="btn btn-primary btn-block submit" ?disabled=${this.busy}>
            ${this.busy ? html`<span class="spinner"></span>` : t('login.submit')}
          </button>
        </form>
      </main>
    `;
  }

  static override styles = [
    sharedStyles,
    css`
      main {
        display: grid;
        place-items: center;
        min-height: 100vh;
        min-height: 100dvh;
        padding: calc(24px + env(safe-area-inset-top)) 20px calc(24px + env(safe-area-inset-bottom));
      }

      form {
        display: grid;
        gap: 16px;
        width: min(360px, 100%);
      }

      header {
        display: grid;
        justify-items: center;
        gap: 6px;
        margin-bottom: 12px;
        text-align: center;
      }

      header dds-logo {
        margin-bottom: 10px;
      }

      h1 {
        font-size: 22px;
        font-weight: 700;
        letter-spacing: -0.01em;
      }

      .fields input {
        display: block;
        width: 100%;
        min-height: var(--row-height);
        padding: 0 16px;
        border: none;
        font: inherit;
        font-size: 16px;
        color: var(--text);
        background: transparent;
        outline: none;
      }

      .fields input + input {
        border-top: 0.5px solid var(--separator);
      }

      .fields input::placeholder {
        color: var(--text-tertiary);
      }

      .fields:focus-within {
        box-shadow: var(--focus-ring);
      }

      .fields .otp {
        letter-spacing: 0.2em;
      }

      .hint {
        margin-top: -8px;
        padding: 0 16px;
      }

      .submit {
        min-height: 50px;
        margin-top: 4px;
        font-size: 17px;
        border-radius: var(--radius-lg);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'dds-login-page': DdsLoginPage;
  }
}
