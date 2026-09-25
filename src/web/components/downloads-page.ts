import { LitElement, css, html, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { JobView } from '../../shared/types.js';
import { api, ApiError } from '../api.js';
import { errorMessage, t } from '../i18n.js';
import { mdiCheckCircle, mdiCircleOutline, mdiTrayArrowDown } from '../icons.js';
import { store, StoreController } from '../store.js';
import './download-row.js';
import type { DdsDownloadSheet } from './download-sheet.js';
import './download-sheet.js';
import './icon.js';
import { sharedStyles } from './styles.js';

const isFinished = (job: JobView) => job.status === 'completed' || job.status === 'cancelled';
const finishedAt = (job: JobView) => job.finishedAt ?? job.updatedAt;

/** Home screen: setup checklist, running and finished downloads. */
@customElement('dds-downloads-page')
export class DdsDownloadsPage extends LitElement {
  @state() private clearing = false;

  @query('dds-download-sheet') private sheet!: DdsDownloadSheet;

  private clock: ReturnType<typeof setInterval> | undefined;

  constructor() {
    super();
    new StoreController(this);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Keeps « Il y a 5 min » current when nothing else changes.
    this.clock = setInterval(() => {
      for (const row of this.renderRoot.querySelectorAll('dds-download-row')) row.requestUpdate();
    }, 30_000);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearInterval(this.clock);
  }

  private async clear(): Promise<void> {
    const ids = store.jobs.filter(isFinished).map((job) => job.id);
    this.clearing = true;
    try {
      await api.clearJobs();
      store.removeJobs(ids);
    } catch (error) {
      store.toast(errorMessage(error instanceof ApiError ? error.info.code : 'internal'), 'error');
    } finally {
      this.clearing = false;
    }
  }

  private openAdd(): void {
    this.dispatchEvent(new CustomEvent('dds-open-add', { bubbles: true, composed: true }));
  }

  override render() {
    const settings = store.settings;
    const hasProvider = settings?.providers.some((provider) => provider.configured) ?? true;
    const hasDestination = settings ? settings.categories.length > 0 : true;
    const configured = hasProvider && hasDestination;

    const jobs = store.jobs;
    // Failed jobs stay with the running ones, where they can be retried.
    const active = jobs.filter((job) => !isFinished(job)).sort((a, b) => b.createdAt - a.createdAt);
    const finished = jobs.filter(isFinished).sort((a, b) => finishedAt(b) - finishedAt(a));

    return html`
      ${configured ? nothing : this.renderSetup(hasProvider, hasDestination)}
      ${
        jobs.length
          ? html`
              ${this.renderSection(t('downloads.active'), active)}
              ${this.renderSection(
                t('downloads.finished'),
                finished,
                html`<button class="btn btn-plain" ?disabled=${this.clearing} @click=${this.clear}>
                  ${t('downloads.clear')}
                </button>`,
              )}
            `
          : this.renderEmpty(configured)
      }
      <dds-download-sheet></dds-download-sheet>
    `;
  }

  private renderSetup(hasProvider: boolean, hasDestination: boolean) {
    const admin = store.session?.user.isAdmin ?? false;
    const step = (done: boolean, title: string) =>
      html`<div class="row step ${done ? 'done' : ''}">
        <span
          class="step-icon"
          role=${done ? 'img' : nothing}
          aria-label=${done ? t('status.completed') : nothing}
        >
          <dds-icon .path=${done ? mdiCheckCircle : mdiCircleOutline}></dds-icon>
        </span>
        <span class="row-title">${title}</span>
      </div>`;
    return html`
      <section class="section">
        <h2 class="section-header">${t('setup.title')}</h2>
        <div class="group with-icons">
          ${step(hasProvider, t('setup.provider'))} ${step(hasDestination, t('setup.destination'))}
          ${admin ? html`<a class="row action" href="#/settings">${t('setup.open')}</a>` : nothing}
        </div>
        ${admin ? nothing : html`<p class="section-footer">${t('setup.adminOnly')}</p>`}
      </section>
    `;
  }

  private renderSection(title: string, jobs: JobView[], action: unknown = nothing) {
    if (!jobs.length) return nothing;
    return html`
      <section class="section">
        <div class="section-header">
          <h2>${title} <span class="count num">· ${jobs.length}</span></h2>
          ${action}
        </div>
        <div class="group rows">
          ${repeat(
            jobs,
            (job) => job.id,
            (job) =>
              html`<dds-download-row
                .job=${job}
                @click=${() => void this.sheet.open(job.id)}
              ></dds-download-row>`,
          )}
        </div>
      </section>
    `;
  }

  private renderEmpty(configured: boolean) {
    return html`
      <div class="empty ${configured ? '' : 'compact'}">
        <dds-icon class="empty-icon" .path=${mdiTrayArrowDown}></dds-icon>
        <h2 class="empty-title">${t('downloads.empty')}</h2>
        <p class="empty-text">${t('downloads.emptyHint')}</p>
        ${
          configured
            ? html`<button class="btn btn-primary" @click=${this.openAdd}>
                ${t('downloads.add')}
              </button>`
            : nothing
        }
      </div>
    `;
  }

  static override styles = [
    sharedStyles,
    css`
      .section-header h2 {
        font-size: inherit;
        font-weight: inherit;
      }

      .count {
        font-weight: 400;
      }

      /* Hairlines between rows, aligned with the text column (16 + 32 tile + 12). */
      .rows > dds-download-row {
        position: relative;
      }

      .rows > dds-download-row + dds-download-row::before {
        content: '';
        position: absolute;
        top: 0;
        right: 0;
        left: 60px;
        z-index: 1;
        height: 1px;
        background: var(--separator);
        transform: scaleY(0.5);
        transform-origin: top;
        pointer-events: none;
      }

      .step-icon {
        display: grid;
        flex: none;
        place-items: center;
        width: 28px;
        height: 28px;
        color: var(--text-tertiary);
      }

      .step-icon dds-icon {
        --icon-size: 24px;
      }

      .step.done .step-icon {
        color: var(--accent);
      }

      .step.done .row-title {
        color: var(--text-secondary);
      }

      .empty {
        display: grid;
        align-content: center;
        justify-items: center;
        gap: 8px;
        min-height: calc(100dvh - 240px);
        padding: 24px 16px;
        text-align: center;
        /* Waits a moment: the list usually arrives right after the page shows. */
        animation: appear 0.3s ease 0.2s both;
      }

      .empty.compact {
        min-height: 0;
        padding-top: 48px;
      }

      @keyframes appear {
        from {
          opacity: 0;
        }
      }

      .empty-icon {
        --icon-size: 44px;
        margin-bottom: 8px;
        color: var(--text-tertiary);
      }

      .empty-title {
        font-size: 17px;
        font-weight: 600;
      }

      .empty-text {
        max-width: 300px;
        color: var(--text-secondary);
      }

      .empty .btn {
        margin-top: 16px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'dds-downloads-page': DdsDownloadsPage;
  }
}
