import { LitElement, css, html, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { CATEGORY_ICONS, type Category, type CategoryIcon } from '../../shared/types.js';
import { t } from '../i18n.js';
import { categoryIcons, mdiClose, mdiFolderOutline } from '../icons.js';
import type { DdsFolderPicker } from './folder-picker.js';
import './folder-picker.js';
import './icon.js';
import { dialogStyles, sharedStyles } from './styles.js';

export interface CategoryDraft {
  id: string;
  name: string;
  icon: CategoryIcon;
  destination: string;
}

/** Creates or edits a category. Fires `save` (detail: Category) or `delete` (detail: id). */
@customElement('dds-category-dialog')
export class DdsCategoryDialog extends LitElement {
  @state() private draft: CategoryDraft = { id: '', name: '', icon: 'movie', destination: '' };
  @state() private isNew = true;

  @query('dialog') private dialog!: HTMLDialogElement;
  @query('dds-folder-picker') private picker!: DdsFolderPicker;

  async open(category: Category | null): Promise<void> {
    this.isNew = !category;
    this.draft = category ? { ...category } : { id: '', name: '', icon: 'movie', destination: '' };
    await this.updateComplete;
    this.dialog.showModal();
  }

  private close(): void {
    this.dialog.close();
  }

  private submit(event: Event): void {
    event.preventDefault();
    const name = this.draft.name.trim();
    const destination = this.draft.destination.trim().replace(/^\/+|\/+$/g, '');
    if (!name || !destination) return;
    this.dispatchEvent(
      new CustomEvent<Category>('save', { detail: { ...this.draft, name, destination } }),
    );
    this.close();
  }

  private deleteCategory(): void {
    if (!confirm(t('category.deleteConfirm', { name: this.draft.name }))) return;
    this.dispatchEvent(new CustomEvent<string>('delete', { detail: this.draft.id }));
    this.close();
  }

  override render() {
    const valid = this.draft.name.trim() && this.draft.destination.trim();
    return html`
      <dialog>
        <form @submit=${this.submit}>
          <div class="dialog-head">
            <h2>${this.isNew ? t('category.new') : t('category.edit')}</h2>
            <button
              type="button"
              class="icon-btn"
              aria-label=${t('common.close')}
              @click=${this.close}
            >
              <dds-icon .path=${mdiClose}></dds-icon>
            </button>
          </div>

          <div class="dialog-body">
            <label class="field">
              ${t('category.name')}
              <input
                class="input"
                maxlength="40"
                placeholder=${t('category.namePlaceholder')}
                .value=${this.draft.name}
                @input=${(event: InputEvent) => {
                  this.draft = { ...this.draft, name: (event.target as HTMLInputElement).value };
                }}
              />
            </label>

            <div class="field-group">
              <span class="field-label">${t('category.icon')}</span>
              <div class="icons" role="radiogroup">
                ${CATEGORY_ICONS.map(
                  (icon) =>
                    html`<button
                      type="button"
                      role="radio"
                      aria-checked=${icon === this.draft.icon}
                      aria-label=${icon}
                      @click=${() => (this.draft = { ...this.draft, icon })}
                    >
                      <dds-icon .path=${categoryIcons[icon]}></dds-icon>
                    </button>`,
                )}
              </div>
            </div>

            <label class="field">
              ${t('category.destination')}
              <div class="destination">
                <input
                  class="input mono"
                  placeholder=${t('category.destinationPlaceholder')}
                  autocapitalize="none"
                  autocorrect="off"
                  spellcheck="false"
                  .value=${this.draft.destination}
                  @input=${(event: InputEvent) => {
                    this.draft = {
                      ...this.draft,
                      destination: (event.target as HTMLInputElement).value,
                    };
                  }}
                />
                <button
                  type="button"
                  class="btn"
                  @click=${() => this.picker.open(this.draft.destination.trim())}
                >
                  <dds-icon .path=${mdiFolderOutline}></dds-icon>${t('category.browse')}
                </button>
              </div>
            </label>
          </div>

          <div class="dialog-foot">
            ${
              this.isNew
                ? nothing
                : html`<button type="button" class="btn btn-danger" @click=${this.deleteCategory}>
                    ${t('category.delete')}
                  </button>`
            }
            <span class="spacer"></span>
            <button type="button" class="btn" @click=${this.close}>${t('common.cancel')}</button>
            <button class="btn btn-primary" ?disabled=${!valid}>${t('common.save')}</button>
          </div>
        </form>
      </dialog>
      <dds-folder-picker
        @pick=${(event: CustomEvent<string>) => {
          this.draft = { ...this.draft, destination: event.detail };
        }}
      ></dds-folder-picker>
    `;
  }

  static override styles = [
    sharedStyles,
    dialogStyles,
    css`
      form {
        display: flex;
        flex-direction: column;
        min-height: 0;
      }

      .field-group {
        display: grid;
        gap: 8px;
      }

      .field-label {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-2);
      }

      .icons {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
        gap: 8px;
      }

      .icons button {
        display: grid;
        place-items: center;
        aspect-ratio: 1;
        border: none;
        border-radius: 14px;
        color: var(--text-2);
        background: var(--surface-2);
        cursor: pointer;
        transition:
          background-color 0.15s ease,
          color 0.15s ease,
          transform 0.12s ease;
      }

      .icons button:active {
        transform: scale(0.94);
      }

      .icons button[aria-checked='true'] {
        color: var(--on-accent);
        background: var(--accent);
      }

      .destination {
        display: flex;
        gap: 8px;
      }

      .destination .input {
        flex: 1;
        min-width: 0;
      }

      .destination .btn {
        flex: none;
        font-weight: 600;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'dds-category-dialog': DdsCategoryDialog;
  }
}
