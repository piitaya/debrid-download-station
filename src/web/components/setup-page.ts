import { LitElement, html, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { MIN_PASSWORD_LENGTH } from '../../shared/types.js';
import { ApiError } from '../api.js';
import { errorMessage, t } from '../i18n.js';
import { mdiAlertCircleOutline } from '../icons.js';
import { store } from '../store.js';
import { authStyles } from './auth-styles.js';
import './icon.js';
import './logo.js';
import { sharedStyles } from './styles.js';

type Field = 'username' | 'password' | 'confirm';

/**
 * First start: creates the app's account. Download Station, the debrid services and the
 * destinations come next, from the list on the downloads screen.
 */
@customElement('dds-setup-page')
export class DdsSetupPage extends LitElement {
  @state() private values: Record<Field, string> = { username: '', password: '', confirm: '' };
  @state() private busy = false;
  @state() private error = '';

  @query('form') private form!: HTMLFormElement;

  private set(field: Field, value: string): void {
    this.values = { ...this.values, [field]: value };
  }

  private async focusField(field: Field, clear = false): Promise<void> {
    if (clear) this.set(field, '');
    await this.updateComplete;
    this.form.querySelector<HTMLInputElement>(`[name="${field}"]`)?.focus();
  }

  private async submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (this.busy) return;
    const { username, password, confirm } = this.values;
    if (!username.trim()) return void this.focusField('username');
    if (password.length < MIN_PASSWORD_LENGTH) {
      this.error = errorMessage('weak_password');
      return void this.focusField('password');
    }
    if (password !== confirm) {
      this.error = t('welcome.mismatch');
      return void this.focusField('confirm', true);
    }

    this.busy = true;
    this.error = '';
    try {
      // Signed in: the app takes over.
      await store.setup({ username: username.trim(), password });
    } catch (error) {
      this.error = errorMessage(error instanceof ApiError ? error.info.code : 'internal');
    } finally {
      this.busy = false;
    }
  }

  override render() {
    return html`
      <main>
        <form @submit=${this.submit} novalidate>
          <header>
            <dds-logo size="56"></dds-logo>
            <h1>${t('welcome.account')}</h1>
            <p class="secondary">${t('welcome.accountHint')}</p>
          </header>
          <div class="group fields">
            ${this.input('username', t('login.username'), 'text', 'username')}
            ${this.input('password', t('login.password'), 'password', 'new-password')}
            ${this.input('confirm', t('welcome.confirm'), 'password', 'new-password')}
          </div>
          <p class="hint small secondary">${t('welcome.passwordRule')}</p>
          ${
            this.error
              ? html`<div class="notice" role="alert">
                  <dds-icon .path=${mdiAlertCircleOutline}></dds-icon>
                  <span>${this.error}</span>
                </div>`
              : nothing
          }
          <button class="btn btn-primary btn-block submit" ?disabled=${this.busy}>
            ${this.busy ? html`<span class="spinner"></span>` : t('welcome.create')}
          </button>
        </form>
      </main>
    `;
  }

  private input(field: Field, placeholder: string, type: string, autocomplete: string) {
    return html`<input
      name=${field}
      type=${type}
      placeholder=${placeholder}
      aria-label=${placeholder}
      autocomplete=${autocomplete}
      autocapitalize="none"
      autocorrect="off"
      spellcheck="false"
      .value=${live(this.values[field])}
      ?disabled=${this.busy}
      @input=${(event: Event) => {
        this.set(field, (event.target as HTMLInputElement).value);
        this.error = '';
      }}
    />`;
  }

  static override styles = [sharedStyles, authStyles];
}

declare global {
  interface HTMLElementTagNameMap {
    'dds-setup-page': DdsSetupPage;
  }
}
