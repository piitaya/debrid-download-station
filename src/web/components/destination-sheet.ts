import { LitElement, css, html, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import {
  CATEGORY_ICONS,
  type Category,
  type CategoryIcon,
  type ErrorCode,
} from '../../shared/types.js';
import { api, ApiError } from '../api.js';
import { errorMessage, iconLabel, t } from '../i18n.js';
import { categoryIcon } from '../icons.js';
import { store, StoreController } from '../store.js';
import { inlineInputStyles, normalizePath, type DdsFolderPicker } from './folder-picker.js';
import './icon.js';
import type { DdsSheet } from './sheet.js';
import './sheet.js';
import { sharedStyles } from './styles.js';

const errorCode = (error: unknown): ErrorCode =>
  error instanceof ApiError ? error.info.code : 'internal';

/** Creates or edits a destination (a named NAS folder offered when adding downloads). */
@customElement('dds-destination-sheet')
export class DdsDestinationSheet extends LitElement {
  /** Destination being edited; null for a new one. */
  @state() private editing: Category | null = null;
  @state() private name = '';
  @state() private folder = '';
  @state() private icon: CategoryIcon = 'folder';
  @state() private isDefault = false;
  @state() private saving = false;
  @state() private deleting = false;

  @query('dds-sheet') private sheet!: DdsSheet;
  @query('dds-folder-picker') private picker!: DdsFolderPicker;
  @query('#name') private nameInput?: HTMLInputElement;

  constructor() {
    super();
    new StoreController(this);
  }

  async open(category: Category | null): Promise<void> {
    this.editing = category;
    this.name = category?.name ?? '';
    this.folder = category?.destination ?? '';
    this.icon = category?.icon ?? 'folder';
    this.isDefault = !!category && store.settings?.defaultCategoryId === category.id;
    await this.updateComplete;
    await this.sheet.show();
    if (!category && matchMedia('(pointer: fine)').matches) this.nameInput?.focus();
  }

  /** The destination is (or becomes) the default whatever the switch says. */
  private get forcedDefault(): boolean {
    const settings = store.settings;
    if (!settings) return false;
    if (!this.editing) return settings.categories.length === 0;
    return settings.defaultCategoryId === this.editing.id;
  }

  private async save(): Promise<void> {
    const settings = store.settings;
    const name = this.name.trim();
    const destination = normalizePath(this.folder);
    if (!settings || !name || !destination || this.saving) return;

    const editing = this.editing;
    const item: Category = { id: editing?.id ?? '', name, icon: this.icon, destination };
    const categories = editing
      ? settings.categories.map((category) => (category.id === editing.id ? item : category))
      : [...settings.categories, item];
    const makeDefault =
      (this.isDefault || this.forcedDefault) && settings.defaultCategoryId !== item.id;

    this.saving = true;
    try {
      let result = await api.updateSettings(
        editing && makeDefault ? { categories, defaultCategoryId: editing.id } : { categories },
      );
      store.setSettings(result);
      if (!editing && makeDefault) {
        // The server gives the new destination its id.
        const created =
          result.categories.findLast((c) => c.name === name && c.destination === destination) ??
          result.categories.at(-1);
        if (created) {
          result = await api.updateSettings({ defaultCategoryId: created.id });
          store.setSettings(result);
        }
      }
      store.toast(t('settings.saved'), 'success');
      this.sheet.close();
    } catch (error) {
      store.toast(errorMessage(errorCode(error)), 'error');
    } finally {
      this.saving = false;
    }
  }

  private async deleteDestination(): Promise<void> {
    const settings = store.settings;
    const editing = this.editing;
    if (!settings || !editing) return;
    if (!confirm(t('destination.deleteConfirm', { name: editing.name }))) return;
    this.deleting = true;
    try {
      const categories = settings.categories.filter((category) => category.id !== editing.id);
      store.setSettings(await api.updateSettings({ categories }));
      store.toast(t('settings.saved'), 'success');
      this.sheet.close();
    } catch (error) {
      store.toast(errorMessage(errorCode(error)), 'error');
    } finally {
      this.deleting = false;
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    void this.save();
  }

  override render() {
    const valid = !!this.name.trim() && !!normalizePath(this.folder);
    const forcedDefault = this.forcedDefault;

    return html`
      <dds-sheet
        heading=${this.editing ? t('destination.edit') : t('destination.new')}
        primaryLabel=${t('common.save')}
        ?primaryDisabled=${!valid || this.deleting}
        ?busy=${this.saving}
        @dds-primary=${this.save}
      >
        <section class="section">
          <div class="group">
            <div class="row field-row">
              <label class="field-label" for="name">${t('destination.name')}</label>
              <input
                id="name"
                class="inline-input"
                .value=${live(this.name)}
                maxlength="40"
                placeholder=${t('destination.namePlaceholder')}
                autocomplete="off"
                @input=${(event: Event) => (this.name = (event.target as HTMLInputElement).value)}
                @keydown=${this.onKeyDown}
              />
            </div>
            <div class="row field-row">
              <label class="field-label" for="folder">${t('destination.folderShort')}</label>
              <input
                id="folder"
                class="inline-input mono-input"
                aria-label=${t('destination.folder')}
                .value=${live(this.folder)}
                placeholder=${t('destination.folderPlaceholder')}
                autocomplete="off"
                autocapitalize="off"
                autocorrect="off"
                spellcheck="false"
                @input=${(event: Event) => (this.folder = (event.target as HTMLInputElement).value)}
                @keydown=${this.onKeyDown}
              />
              <button class="btn btn-plain btn-sm" @click=${() => this.picker.open(this.folder)}>
                ${t('destination.browse')}
              </button>
            </div>
          </div>
        </section>

        <section class="section">
          <h3 class="section-header">${t('destination.icon')}</h3>
          <div class="group icons" role="group" aria-label=${t('destination.icon')}>
            ${CATEGORY_ICONS.map(
              (icon) =>
                html`<button
                  class="icon-choice"
                  aria-label=${iconLabel(icon)}
                  aria-pressed=${this.icon === icon ? 'true' : 'false'}
                  title=${iconLabel(icon)}
                  @click=${() => (this.icon = icon)}
                >
                  <dds-icon .path=${categoryIcon(icon)}></dds-icon>
                </button>`,
            )}
          </div>
        </section>

        <section class="section">
          <div class="group">
            <label class="row ${forcedDefault ? 'locked' : ''}">
              <span class="row-main"
                ><span class="row-title">${t('destination.default')}</span></span
              >
              <input
                type="checkbox"
                class="switch"
                role="switch"
                .checked=${live(forcedDefault || this.isDefault)}
                ?disabled=${forcedDefault}
                @change=${(event: Event) =>
                  (this.isDefault = (event.target as HTMLInputElement).checked)}
              />
            </label>
          </div>
        </section>

        ${
          this.editing
            ? html`<section class="section">
                <div class="group">
                  <button
                    class="row destructive"
                    ?disabled=${this.saving || this.deleting}
                    @click=${this.deleteDestination}
                  >
                    ${t('destination.delete')}
                  </button>
                </div>
              </section>`
            : nothing
        }
      </dds-sheet>
      <dds-folder-picker
        @dds-pick=${(event: CustomEvent<string>) => (this.folder = event.detail)}
      ></dds-folder-picker>
    `;
  }

  static override styles = [
    sharedStyles,
    inlineInputStyles,
    css`
      .row:focus-visible {
        box-shadow: inset var(--focus-ring);
      }

      .field-row {
        padding-top: 4px;
        padding-bottom: 4px;
      }

      .field-label {
        flex: none;
        width: 100px;
        color: var(--text-secondary);
        cursor: default;
      }

      .field-row .btn-sm {
        flex: none;
        margin-right: -8px;
      }

      /* Two rows of 7: squares of 44px at most, a bit less on narrow phones. */
      .icons {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        justify-items: center;
        gap: 8px;
        padding: 12px;
      }

      .icon-choice {
        display: grid;
        place-items: center;
        width: 100%;
        max-width: 44px;
        aspect-ratio: 1;
        padding: 0;
        border: none;
        border-radius: 10px;
        color: var(--text-secondary);
        background: var(--fill);
        cursor: pointer;
        transition:
          background-color 0.15s ease,
          color 0.15s ease;
      }

      .icon-choice:hover {
        background: var(--fill-hover);
      }

      .icon-choice[aria-pressed='true'] {
        color: var(--text-on-accent);
        background: var(--accent);
      }

      .icon-choice dds-icon {
        --icon-size: 24px;
      }

      label.row.locked {
        cursor: default;
      }

      label.row.locked:hover {
        background: transparent;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'dds-destination-sheet': DdsDestinationSheet;
  }
}
