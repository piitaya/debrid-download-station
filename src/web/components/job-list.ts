import { LitElement, css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { ACTIVE_JOB_STATUSES } from '../../shared/types.js';
import { api, ApiError } from '../api.js';
import { errorMessage, t } from '../i18n.js';
import { mdiBroom, mdiTrayArrowDown } from '../icons.js';
import { store, StoreController } from '../store.js';
import './icon.js';
import './job-card.js';
import { sharedStyles } from './styles.js';

@customElement('dds-job-list')
export class DdsJobList extends LitElement {
  @state() private clearing = false;

  constructor() {
    super();
    new StoreController(this);
  }

  private async clearFinished(): Promise<void> {
    this.clearing = true;
    try {
      await api.clearJobs();
      store.removeJobs(
        store.jobs.filter((job) => !ACTIVE_JOB_STATUSES.includes(job.status)).map((job) => job.id),
      );
    } catch (error) {
      store.toast(errorMessage(error instanceof ApiError ? error.info.code : 'internal'), 'error');
    } finally {
      this.clearing = false;
    }
  }

  override render() {
    const jobs = [...store.jobs].sort((a, b) => b.createdAt - a.createdAt);
    const active = jobs.filter((job) => ACTIVE_JOB_STATUSES.includes(job.status)).length;
    const finished = jobs.length - active;

    return html`
      <section>
        <div class="head">
          <h2>${t('jobs.title')}</h2>
          ${active ? html`<span class="badge accent">${t('jobs.active', { count: active })}</span>` : nothing}
          <span class="spacer"></span>
          ${
            finished
              ? html`<button
                  class="btn btn-sm btn-ghost"
                  ?disabled=${this.clearing}
                  @click=${this.clearFinished}
                >
                  <dds-icon .path=${mdiBroom}></dds-icon>${t('jobs.clear')}
                </button>`
              : nothing
          }
        </div>

        ${
          jobs.length
            ? html`<div class="list">
                ${jobs.map((job) => html`<dds-job-card .job=${job}></dds-job-card>`)}
              </div>`
            : html`<div class="empty card">
                <div class="empty-icon"><dds-icon .path=${mdiTrayArrowDown}></dds-icon></div>
                <p class="empty-title">${t('jobs.empty')}</p>
                <p class="muted small">${t('jobs.emptyHint')}</p>
              </div>`
        }
      </section>
    `;
  }

  static override styles = [
    sharedStyles,
    css`
      section {
        display: grid;
        gap: 14px;
      }

      .head {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 40px;
        padding: 0 4px;
      }

      h2 {
        font-size: 20px;
        font-weight: 700;
        letter-spacing: -0.01em;
      }

      .spacer {
        flex: 1;
      }

      .head .btn {
        margin-right: -8px;
      }

      .list {
        display: grid;
        gap: 12px;
      }

      .empty {
        display: grid;
        justify-items: center;
        gap: 6px;
        padding: 40px 24px;
        text-align: center;
      }

      .empty-icon {
        display: grid;
        place-items: center;
        width: 64px;
        height: 64px;
        margin-bottom: 8px;
        border-radius: 20px;
        color: var(--accent);
        background: var(--accent-soft);
      }

      .empty-icon dds-icon {
        --icon-size: 32px;
      }

      .empty-title {
        font-weight: 600;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'dds-job-list': DdsJobList;
  }
}
