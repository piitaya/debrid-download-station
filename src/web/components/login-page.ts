import { LitElement, css, html, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { ApiError } from '../api.js';
import { errorMessage, t } from '../i18n.js';
import { mdiAlertCircleOutline, mdiShieldKeyOutline } from '../icons.js';
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
      <div class="wrap">
        <form class="card" @submit=${this.submit}>
          <div class="head">
            <dds-logo size="64"></dds-logo>
            <h1>${t('app.title')}</h1>
            <p class="muted">${t('login.subtitle')}</p>
          </div>

          <label class="field">
            ${t('login.username')}
            <input
              class="input"
              name="username"
              autocomplete="username"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
              required
              ?disabled=${this.busy}
            />
          </label>
          <label class="field">
            ${t('login.password')}
            <input
              class="input"
              name="password"
              type="password"
              autocomplete="current-password"
              required
              ?disabled=${this.busy}
            />
          </label>

          ${
            this.needOtp
              ? html`<label class="field otp">
                  <span class="otp-label">
                    <dds-icon .path=${mdiShieldKeyOutline}></dds-icon>${t('login.otp')}
                  </span>
                  <input
                    class="input"
                    name="otp"
                    inputmode="numeric"
                    autocomplete="one-time-code"
                    pattern="[0-9]*"
                    maxlength="8"
                    required
                    ?disabled=${this.busy}
                  />
                  <span class="hint">${t('login.otpHint')}</span>
                </label>`
              : nothing
          }
          ${
            this.error
              ? html`<div class="error-box" role="alert">
                  <dds-icon .path=${mdiAlertCircleOutline}></dds-icon>
                  <span>${this.error}</span>
                </div>`
              : nothing
          }

          <button class="btn btn-primary btn-lg btn-block" ?disabled=${this.busy}>
            ${this.busy ? html`<span class="spinner"></span>` : t('login.submit')}
          </button>
        </form>
      </div>
    `;
  }

  static override styles = [
    sharedStyles,
    css`
      .wrap {
        display: grid;
        place-items: center;
        min-height: 100vh;
        min-height: 100dvh;
        padding: calc(24px + env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom));
      }

      form {
        display: grid;
        gap: 16px;
        width: min(400px, 100%);
        padding: 32px 24px 24px;
        animation: rise 0.4s cubic-bezier(0.2, 0.9, 0.3, 1);
      }

      @keyframes rise {
        from {
          opacity: 0;
          transform: translateY(16px);
        }
      }

      .head {
        display: grid;
        justify-items: center;
        gap: 6px;
        margin-bottom: 8px;
        text-align: center;
      }

      .head dds-logo {
        margin-bottom: 10px;
      }

      h1 {
        font-size: 22px;
        font-weight: 700;
        letter-spacing: -0.01em;
      }

      .otp {
        animation: rise 0.3s ease;
      }

      .otp-label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .otp-label dds-icon {
        --icon-size: 18px;
        color: var(--accent);
      }

      .otp .input {
        font-size: 22px;
        letter-spacing: 0.3em;
        text-align: center;
      }

      .hint {
        font-weight: 400;
        font-size: 13px;
        color: var(--text-3);
      }

      button {
        margin-top: 4px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'dds-login-page': DdsLoginPage;
  }
}
