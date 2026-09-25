import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { styleMap } from 'lit/directives/style-map.js';
import { ACTIVE_JOB_STATUSES, PROVIDERS, type JobView } from '../../shared/types.js';
import { api, ApiError } from '../api.js';
import { breakable, formatBytes, formatPercent, formatRelative, formatSpeed } from '../format.js';
import { errorMessage, t } from '../i18n.js';
import {
  categoryIcon,
  mdiAlertCircle,
  mdiCancel,
  mdiCheckCircle,
  mdiChevronDown,
  mdiCloudDownloadOutline,
  mdiDeleteOutline,
  mdiFolderOutline,
  mdiLockOutline,
  mdiRefresh,
  mdiSend,
  mdiTrayArrowDown,
} from '../icons.js';
import { store } from '../store.js';
import './icon.js';
import { sharedStyles } from './styles.js';

const MAX_FILES_SHOWN = 100;

@customElement('dds-job-card')
export class DdsJobCard extends LitElement {
  @property({ attribute: false }) job!: JobView;
  @state() private expanded = false;
  @state() private busy = false;

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.busy = true;
    try {
      await action();
    } catch (error) {
      store.toast(errorMessage(error instanceof ApiError ? error.info.code : 'internal'), 'error');
    } finally {
      this.busy = false;
    }
  }

  private retry(): Promise<void> {
    return this.run(async () => store.upsertJob(await api.retryJob(this.job.id)));
  }

  private cancel(): Promise<void> {
    if (!confirm(t('jobs.cancelConfirm'))) return Promise.resolve();
    return this.run(async () => {
      await api.deleteJob(this.job.id, true);
      store.removeJobs([this.job.id]);
    });
  }

  private removeFromList(): Promise<void> {
    return this.run(async () => {
      await api.deleteJob(this.job.id, false);
      store.removeJobs([this.job.id]);
    });
  }

  private status() {
    const job = this.job;
    const provider = PROVIDERS[job.provider].name;
    const done = job.files.filter((file) => file.status === 'completed').length;
    switch (job.status) {
      case 'debrid':
        return {
          icon: mdiCloudDownloadOutline,
          tone: 'accent',
          label:
            job.detail === 'queued'
              ? t('status.debridQueued', { provider })
              : t('status.debrid', { provider }),
        };
      case 'sending':
        return { icon: mdiSend, tone: 'accent', label: t('status.sending') };
      case 'waiting_login':
        return { icon: mdiLockOutline, tone: 'warning', label: t('status.waiting_login') };
      case 'downloading':
        return {
          icon: mdiTrayArrowDown,
          tone: 'accent',
          label:
            job.files.length > 1
              ? t('status.downloadingFiles', { done, total: job.files.length })
              : t('status.downloading'),
        };
      case 'completed':
        return { icon: mdiCheckCircle, tone: 'success', label: t('status.completed') };
      case 'cancelled':
        return { icon: mdiCancel, tone: 'muted', label: t('status.cancelled') };
      default:
        return { icon: mdiAlertCircle, tone: 'danger', label: errorMessage(job.error?.code) };
    }
  }

  override render() {
    const job = this.job;
    const active = ACTIVE_JOB_STATUSES.includes(job.status);
    const status = this.status();
    const showProgress =
      job.status === 'debrid' || job.status === 'downloading' || job.status === 'sending';
    const determinate = job.progress !== null && job.status !== 'sending';
    const extras = [
      determinate ? formatPercent(job.progress) : '',
      active ? formatSpeed(job.speed) : '',
      job.status === 'debrid' && job.seeders !== null
        ? t('status.seeders', { count: job.seeders })
        : '',
    ].filter(Boolean);

    return html`
      <article class="card ${status.tone}">
        <button
          class="summary"
          aria-expanded=${this.expanded}
          @click=${() => (this.expanded = !this.expanded)}
        >
          <span class="status-icon"><dds-icon .path=${status.icon}></dds-icon></span>
          <span class="main">
            <span class="name">${breakable(job.name)}</span>
            <span class="meta">
              ${
                job.categoryName
                  ? html`<span class="badge"
                      ><dds-icon .path=${categoryIcon(job.categoryIcon)}></dds-icon
                      >${job.categoryName}</span
                    >`
                  : nothing
              }
              <span>${PROVIDERS[job.provider].name}</span>
              ${job.size ? html`<span>${formatBytes(job.size)}</span>` : nothing}
              <span>${formatRelative(job.createdAt)}</span>
            </span>
          </span>
          <dds-icon
            class=${classMap({ chevron: true, open: this.expanded })}
            .path=${mdiChevronDown}
          ></dds-icon>
        </button>

        ${
          showProgress
            ? html`<div class=${classMap({ progress: true, indeterminate: !determinate })}>
                <span
                  style=${styleMap(determinate ? { width: `${(job.progress ?? 0) * 100}%` } : {})}
                ></span>
              </div>`
            : nothing
        }

        <div class="status-line">
          <span class="label">${status.label}</span>
          ${extras.length ? html`<span class="extras">${extras.join(' · ')}</span>` : nothing}
        </div>
        ${
          job.status === 'error' && job.error?.message
            ? html`<p class="error-detail small">${job.error.message}</p>`
            : nothing
        }
        ${
          job.status === 'error' && !this.expanded
            ? html`<div class="actions">
                <button class="btn btn-sm" ?disabled=${this.busy} @click=${this.retry}>
                  <dds-icon .path=${mdiRefresh}></dds-icon>${t('jobs.retry')}
                </button>
              </div>`
            : nothing
        }
        ${this.expanded ? this.renderDetails(active) : nothing}
      </article>
    `;
  }

  private renderDetails(active: boolean) {
    const job = this.job;
    const files = job.files.slice(0, MAX_FILES_SHOWN);
    return html`
      <div class="details">
        <div class="detail-row">
          <dds-icon .path=${mdiFolderOutline}></dds-icon>
          <span class="mono path">${breakable(job.destination)}</span>
        </div>
        ${
          files.length
            ? html`<ul class="files">
                ${files.map(
                  (file) =>
                    html`<li class=${file.status}>
                      <span class="file-name">${breakable(file.path)}</span>
                      <span class="file-state">
                        ${
                          file.status === 'downloading' && file.progress !== null
                            ? formatPercent(file.progress)
                            : t(`file.${file.status}`)
                        }
                        · ${formatBytes(file.size)}
                      </span>
                    </li>`,
                )}
                ${
                  job.files.length > files.length
                    ? html`<li class="more">+ ${job.files.length - files.length}</li>`
                    : nothing
                }
              </ul>`
            : nothing
        }
        <div class="actions">
          ${
            job.status === 'error'
              ? html`<button class="btn btn-sm" ?disabled=${this.busy} @click=${this.retry}>
                  <dds-icon .path=${mdiRefresh}></dds-icon>${t('jobs.retry')}
                </button>`
              : nothing
          }
          ${
            active
              ? html`<button
                  class="btn btn-sm btn-danger"
                  ?disabled=${this.busy}
                  @click=${this.cancel}
                >
                  <dds-icon .path=${mdiCancel}></dds-icon>${t('jobs.cancel')}
                </button>`
              : html`<button
                  class="btn btn-sm"
                  ?disabled=${this.busy}
                  @click=${this.removeFromList}
                >
                  <dds-icon .path=${mdiDeleteOutline}></dds-icon>${t('jobs.remove')}
                </button>`
          }
        </div>
      </div>
    `;
  }

  static override styles = [
    sharedStyles,
    css`
      article {
        --tone: var(--accent);
        --tone-soft: var(--accent-soft);
        display: grid;
        gap: 12px;
        padding: 14px 16px 16px;
        animation: appear 0.25s ease;
      }

      @keyframes appear {
        from {
          opacity: 0;
          transform: translateY(6px);
        }
      }

      article.success {
        --tone: var(--success);
        --tone-soft: var(--success-soft);
      }

      article.warning {
        --tone: var(--warning);
        --tone-soft: var(--warning-soft);
      }

      article.danger {
        --tone: var(--danger);
        --tone-soft: var(--danger-soft);
      }

      article.muted {
        --tone: var(--text-3);
        --tone-soft: var(--surface-2);
      }

      .summary {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        width: 100%;
        padding: 0;
        border: none;
        font: inherit;
        text-align: left;
        color: inherit;
        background: none;
        cursor: pointer;
      }

      .status-icon {
        display: grid;
        flex: none;
        place-items: center;
        width: 40px;
        height: 40px;
        border-radius: 12px;
        color: var(--tone);
        background: var(--tone-soft);
      }

      .status-icon dds-icon {
        --icon-size: 22px;
      }

      .main {
        display: grid;
        flex: 1;
        gap: 6px;
        min-width: 0;
      }

      .name {
        display: -webkit-box;
        overflow: hidden;
        font-weight: 600;
        line-height: 1.3;
        overflow-wrap: anywhere;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }

      .meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 10px;
        font-size: 13px;
        color: var(--text-2);
      }

      .chevron {
        --icon-size: 22px;
        margin-top: 8px;
        color: var(--text-3);
        transition: transform 0.2s ease;
      }

      .chevron.open {
        transform: rotate(180deg);
      }

      .status-line {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        justify-content: space-between;
        gap: 2px 12px;
        margin-top: -2px;
        font-size: 14px;
      }

      .status-line .label {
        font-weight: 600;
        color: var(--tone);
      }

      .status-line .extras {
        color: var(--text-2);
        font-variant-numeric: tabular-nums;
      }

      .error-detail {
        margin-top: -6px;
        color: var(--text-2);
        word-break: break-word;
      }

      .details {
        display: grid;
        gap: 12px;
        padding-top: 12px;
        border-top: 1px solid var(--border);
        animation: appear 0.2s ease;
      }

      .detail-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        color: var(--text-2);
      }

      .detail-row dds-icon {
        --icon-size: 18px;
      }

      .path {
        overflow-wrap: anywhere;
      }

      .files {
        display: grid;
        gap: 2px;
        max-height: 280px;
        margin: 0;
        padding: 0;
        overflow-y: auto;
        list-style: none;
        font-size: 13px;
      }

      .files li {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 6px 10px;
        border-radius: 8px;
        background: var(--surface-2);
      }

      .file-name {
        min-width: 0;
        overflow-wrap: anywhere;
      }

      .file-state {
        flex: none;
        color: var(--text-2);
        font-variant-numeric: tabular-nums;
      }

      .files li.completed .file-state {
        color: var(--success);
      }

      .files li.error .file-state {
        color: var(--danger);
      }

      .files li.more {
        justify-content: center;
        color: var(--text-2);
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
      }

      .actions dds-icon {
        --icon-size: 18px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'dds-job-card': DdsJobCard;
  }
}
