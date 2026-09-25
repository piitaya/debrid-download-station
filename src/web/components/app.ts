import { LitElement, css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { t } from '../i18n.js';
import {
  mdiAlertCircleOutline,
  mdiCheckCircle,
  mdiChevronLeft,
  mdiCogOutline,
  mdiInformationOutline,
  mdiWifiOff,
} from '../icons.js';
import { store, StoreController } from '../store.js';
import './add-card.js';
import './icon.js';
import './job-list.js';
import './login-page.js';
import './logo.js';
import './settings-page.js';
import { sharedStyles } from './styles.js';

type Route = 'home' | 'settings';

const routeFromHash = (): Route => (location.hash.startsWith('#/settings') ? 'settings' : 'home');

@customElement('dds-app')
export class DdsApp extends LitElement {
  @state() private route: Route = routeFromHash();

  constructor() {
    super();
    new StoreController(this);
  }

  private readonly onHashChange = () => {
    this.route = routeFromHash();
    window.scrollTo({ top: 0 });
  };

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('hashchange', this.onHashChange);
    void store.init();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('hashchange', this.onHashChange);
  }

  private navigate(route: Route): void {
    location.hash = route === 'settings' ? '#/settings' : '#/';
  }

  override render() {
    if (!store.ready) {
      return html`<div class="splash"><dds-logo size="72"></dds-logo></div>`;
    }
    if (!store.session) {
      return html`<dds-login-page></dds-login-page>${this.renderToasts()}`;
    }

    const settings = this.route === 'settings';
    return html`
      <header>
        <div class="bar">
          ${
            settings
              ? html`<button
                  class="icon-btn back"
                  aria-label=${t('nav.back')}
                  @click=${() => this.navigate('home')}
                >
                  <dds-icon .path=${mdiChevronLeft}></dds-icon>
                </button>`
              : html`<a class="brand" href="#/" aria-label=${t('app.title')}>
                  <dds-logo size="34"></dds-logo>
                </a>`
          }
          <h1>${settings ? t('settings.title') : t('app.short')}</h1>
          ${
            settings
              ? nothing
              : html`<button
                  class="icon-btn"
                  aria-label=${t('nav.settings')}
                  title=${t('nav.settings')}
                  @click=${() => this.navigate('settings')}
                >
                  <dds-icon .path=${mdiCogOutline}></dds-icon>
                </button>`
          }
        </div>
        ${
          store.online
            ? nothing
            : html`<div class="offline" role="status">
                <dds-icon .path=${mdiWifiOff}></dds-icon>${t('common.offline')}
              </div>`
        }
      </header>
      <main class=${settings ? 'settings' : 'home'}>
        ${
          settings
            ? html`<dds-settings-page></dds-settings-page>`
            : html`
                <dds-add-card></dds-add-card>
                <dds-job-list></dds-job-list>
              `
        }
      </main>
      ${this.renderToasts()}
    `;
  }

  private renderToasts() {
    const icons = {
      info: mdiInformationOutline,
      success: mdiCheckCircle,
      error: mdiAlertCircleOutline,
    };
    return html`<div class="toasts" aria-live="polite">
      ${store.toasts.map(
        (toast) =>
          html`<button class="toast ${toast.kind}" @click=${() => store.dismissToast(toast.id)}>
            <dds-icon .path=${icons[toast.kind]}></dds-icon>
            <span>${toast.message}</span>
          </button>`,
      )}
    </div>`;
  }

  static override styles = [
    sharedStyles,
    css`
      .splash {
        display: grid;
        place-items: center;
        min-height: 100vh;
        min-height: 100dvh;
        animation: pulse 1.6s ease-in-out infinite;
      }

      @keyframes pulse {
        50% {
          opacity: 0.55;
          transform: scale(0.96);
        }
      }

      header {
        position: sticky;
        top: 0;
        z-index: 10;
        padding-top: env(safe-area-inset-top);
        background: var(--header-bg);
        -webkit-backdrop-filter: saturate(180%) blur(20px);
        backdrop-filter: saturate(180%) blur(20px);
        border-bottom: 1px solid var(--border);
      }

      .bar {
        display: flex;
        align-items: center;
        gap: 12px;
        max-width: 1120px;
        min-height: 60px;
        margin: 0 auto;
        padding: 0 max(16px, env(safe-area-inset-right)) 0 max(16px, env(safe-area-inset-left));
      }

      .bar .back {
        margin-left: -10px;
        color: var(--accent);
      }

      .brand {
        display: inline-flex;
      }

      h1 {
        flex: 1;
        font-size: 19px;
        font-weight: 700;
        letter-spacing: -0.01em;
      }

      .offline {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 6px 16px 8px;
        font-size: 13px;
        font-weight: 600;
        color: var(--warning);
      }

      .offline dds-icon {
        --icon-size: 16px;
      }

      main {
        max-width: 1120px;
        margin: 0 auto;
        padding: 20px max(16px, env(safe-area-inset-right)) calc(32px + env(safe-area-inset-bottom))
          max(16px, env(safe-area-inset-left));
      }

      main.home {
        display: grid;
        gap: 20px;
        align-items: start;
      }

      main.settings {
        max-width: 720px;
      }

      @media (min-width: 900px) {
        main {
          padding-top: 28px;
        }

        main.home {
          grid-template-columns: minmax(360px, 420px) 1fr;
          gap: 28px;
        }

        main.home dds-add-card {
          position: sticky;
          top: 88px;
        }
      }

      .toasts {
        position: fixed;
        left: 50%;
        bottom: calc(16px + env(safe-area-inset-bottom));
        z-index: 100;
        display: grid;
        gap: 8px;
        width: min(460px, calc(100% - 32px));
        transform: translateX(-50%);
        pointer-events: none;
      }

      .toast {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 16px;
        border: none;
        border-radius: 14px;
        font: inherit;
        font-size: 15px;
        font-weight: 500;
        text-align: left;
        color: var(--text);
        background: var(--surface);
        box-shadow: var(--shadow-lg);
        pointer-events: auto;
        cursor: pointer;
        animation: toast-in 0.28s cubic-bezier(0.2, 0.9, 0.3, 1.2);
      }

      .toast dds-icon {
        --icon-size: 22px;
        color: var(--accent);
      }

      .toast.success dds-icon {
        color: var(--success);
      }

      .toast.error dds-icon {
        color: var(--danger);
      }

      @keyframes toast-in {
        from {
          opacity: 0;
          transform: translateY(12px) scale(0.98);
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'dds-app': DdsApp;
  }
}
