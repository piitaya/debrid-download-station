import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { t } from '../i18n.js';
import { mdiClose } from '../icons.js';
import './icon.js';
import { sharedStyles } from './styles.js';

/**
 * Modal panel used for every secondary screen: a bottom sheet on phones, a centered dialog on
 * larger screens. Content goes in the default slot.
 *
 * Events: `dds-primary` when the primary button is pressed, `dds-closed` once closed.
 */
@customElement('dds-sheet')
export class DdsSheet extends LitElement {
  @property() heading = '';
  /** Label of the primary action; no footer when empty. */
  @property() primaryLabel = '';
  @property({ type: Boolean }) primaryDisabled = false;
  /** Shows a spinner in the primary button. */
  @property({ type: Boolean }) busy = false;
  /** Wider panel on large screens. */
  @property({ type: Boolean }) wide = false;

  @query('dialog') private dialog!: HTMLDialogElement;

  get open(): boolean {
    return this.dialog?.open ?? false;
  }

  async show(): Promise<void> {
    await this.updateComplete;
    if (!this.dialog.open) this.dialog.showModal();
  }

  close(): void {
    if (this.dialog?.open) this.dialog.close();
  }

  private onClick(event: MouseEvent): void {
    // A click on the backdrop reaches the <dialog> itself, outside of its box.
    if (event.target !== this.dialog) return;
    const box = this.dialog.getBoundingClientRect();
    const inside =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom;
    if (!inside) this.close();
  }

  private primary(): void {
    if (this.primaryDisabled || this.busy) return;
    this.dispatchEvent(new CustomEvent('dds-primary'));
  }

  override render() {
    return html`
      <dialog
        class=${this.wide ? 'wide' : ''}
        aria-label=${this.heading}
        @click=${this.onClick}
        @close=${() => this.dispatchEvent(new CustomEvent('dds-closed'))}
      >
        <header>
          <h2>${this.heading}</h2>
          <button class="icon-btn" aria-label=${t('common.close')} @click=${() => this.close()}>
            <dds-icon .path=${mdiClose}></dds-icon>
          </button>
        </header>
        <div class="body"><slot></slot></div>
        ${
          this.primaryLabel
            ? html`<footer>
                <button class="btn cancel" @click=${() => this.close()}>
                  ${t('common.cancel')}
                </button>
                <button
                  class="btn btn-primary"
                  ?disabled=${this.primaryDisabled || this.busy}
                  @click=${this.primary}
                >
                  ${this.busy ? html`<span class="spinner"></span>` : this.primaryLabel}
                </button>
              </footer>`
            : nothing
        }
      </dialog>
    `;
  }

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: contents;
      }

      dialog {
        display: none;
        flex-direction: column;
        width: 100%;
        max-width: 100%;
        max-height: calc(100dvh - env(safe-area-inset-top) - 16px);
        margin: auto 0 0;
        padding: 0;
        border: none;
        border-radius: 14px 14px 0 0;
        color: var(--text);
        background: var(--bg-sheet);
        box-shadow: var(--shadow-overlay);
        overflow: hidden;
        /* Groups inside a sheet sit one level higher (visible in dark mode). */
        --bg-elevated: var(--bg-sheet-content);
      }

      dialog[open] {
        display: flex;
        animation: slide-up 0.32s cubic-bezier(0.32, 0.72, 0, 1);
      }

      dialog::backdrop {
        background: rgba(0, 0, 0, 0.4);
        animation: fade-in 0.2s ease;
      }

      @keyframes slide-up {
        from {
          transform: translateY(100%);
        }
      }

      @keyframes fade-in {
        from {
          opacity: 0;
        }
      }

      header {
        display: flex;
        flex: none;
        align-items: center;
        gap: 8px;
        min-height: 56px;
        padding: 8px 8px 8px 20px;
      }

      h2 {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        font-size: 17px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      header .icon-btn {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: var(--fill);
      }

      header .icon-btn dds-icon {
        --icon-size: 18px;
      }

      .body {
        flex: 1;
        min-height: 0;
        padding: 4px 16px 20px;
        overflow-y: auto;
        overscroll-behavior: contain;
      }

      footer {
        display: flex;
        flex: none;
        gap: 8px;
        padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
        border-top: 0.5px solid var(--separator);
        background: var(--bg-sheet);
      }

      /* Phones: one full-width action at the bottom, closing is done with the × button. */
      footer .cancel {
        display: none;
      }

      footer .btn-primary {
        flex: 1;
        min-height: 50px;
        font-size: 17px;
        border-radius: var(--radius-lg);
      }

      @media (min-width: 640px) {
        dialog {
          width: min(520px, calc(100% - 48px));
          max-height: min(760px, calc(100dvh - 64px));
          margin: auto;
          border-radius: 14px;
        }

        dialog.wide {
          width: min(640px, calc(100% - 48px));
        }

        dialog[open] {
          animation: pop-in 0.18s ease-out;
        }

        @keyframes pop-in {
          from {
            opacity: 0;
            transform: scale(0.97);
          }
        }

        footer {
          justify-content: flex-end;
          padding-bottom: 12px;
        }

        footer .cancel {
          display: inline-flex;
        }

        footer .btn-primary {
          flex: none;
          min-height: var(--control-height);
          font-size: 15px;
          border-radius: var(--radius);
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'dds-sheet': DdsSheet;
  }
}
