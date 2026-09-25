import { LitElement, css, html, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import type { Category, SettingsUpdate } from '../../shared/types.js';
import { api, ApiError } from '../api.js';
import { errorMessage, t } from '../i18n.js';
import {
  categoryIcon,
  mdiArrowDown,
  mdiArrowUp,
  mdiLinkVariant,
  mdiLogout,
  mdiNas,
  mdiPencilOutline,
  mdiPlus,
  mdiStar,
  mdiStarOutline,
} from '../icons.js';
import { store, StoreController } from '../store.js';
import type { DdsCategoryDialog } from './category-dialog.js';
import './category-dialog.js';
import './icon.js';
import './provider-card.js';
import { sharedStyles } from './styles.js';

const canRegisterMagnetHandler =
  window.isSecureContext && typeof navigator.registerProtocolHandler === 'function';

@customElement('dds-settings-page')
export class DdsSettingsPage extends LitElement {
  @state() private saving = false;
  @query('dds-category-dialog') private dialog!: DdsCategoryDialog;

  constructor() {
    super();
    new StoreController(this);
  }

  private async saveSettings(patch: SettingsUpdate): Promise<void> {
    this.saving = true;
    try {
      store.setSettings(await api.updateSettings(patch));
    } catch (error) {
      store.toast(errorMessage(error instanceof ApiError ? error.info.code : 'internal'), 'error');
    } finally {
      this.saving = false;
    }
  }

  private saveCategory(category: Category): void {
    const categories = store.settings?.categories ?? [];
    const exists = categories.some((item) => item.id === category.id && category.id);
    void this.saveSettings({
      categories: exists
        ? categories.map((item) => (item.id === category.id ? category : item))
        : [...categories, category],
    });
  }

  private deleteCategory(id: string): void {
    const categories = store.settings?.categories ?? [];
    void this.saveSettings({ categories: categories.filter((item) => item.id !== id) });
  }

  private moveCategory(index: number, delta: number): void {
    const categories = [...(store.settings?.categories ?? [])];
    const target = index + delta;
    if (target < 0 || target >= categories.length) return;
    [categories[index], categories[target]] = [categories[target]!, categories[index]!];
    void this.saveSettings({ categories });
  }

  private registerMagnetHandler(): void {
    try {
      const url = new URL(location.pathname, location.origin);
      navigator.registerProtocolHandler('magnet', `${url.href}?magnet=%s`);
      store.toast(t('settings.magnetHandlerDone'), 'success');
    } catch (error) {
      store.toast((error as Error).message, 'error');
    }
  }

  override render() {
    const settings = store.settings;
    const session = store.session;
    if (!settings || !session) return nothing;
    const isAdmin = session.user.isAdmin;
    const configuredCount = settings.providers.filter((p) => p.configured).length;

    return html`
      ${
        isAdmin
          ? html`
              <section>
                <div class="section-head">
                  <h2 class="section-title">${t('settings.providers')}</h2>
                  <p class="muted small">${t('settings.providersHint')}</p>
                </div>
                <div class="card stack">
                  ${settings.providers.map(
                    (provider) =>
                      html`<dds-provider-card
                        .provider=${provider}
                        ?isDefault=${settings.defaultProvider === provider.id}
                        ?canBeDefault=${configuredCount > 1}
                      ></dds-provider-card>`,
                  )}
                </div>
              </section>

              <section>
                <div class="section-head">
                  <h2 class="section-title">${t('settings.categories')}</h2>
                  <p class="muted small">${t('settings.categoriesHint')}</p>
                </div>
                <div class="card list">
                  ${settings.categories.map((category, index) =>
                    this.renderCategory(
                      category,
                      index,
                      settings.categories.length,
                      settings.defaultCategoryId,
                    ),
                  )}
                  <button class="add-row" @click=${() => this.dialog.open(null)}>
                    <span class="add-icon"><dds-icon .path=${mdiPlus}></dds-icon></span>
                    ${t('settings.addCategory')}
                  </button>
                </div>
              </section>

              <section>
                <h2 class="section-title section-head">${t('settings.options')}</h2>
                <div class="card list">
                  ${this.renderToggle(
                    t('settings.subfolder'),
                    t('settings.subfolderHint'),
                    settings.createSubfolder,
                    (value) => this.saveSettings({ createSubfolder: value }),
                  )}
                  ${this.renderToggle(
                    t('settings.deleteDebrid'),
                    t('settings.deleteDebridHint'),
                    settings.deleteFromDebrid,
                    (value) => this.saveSettings({ deleteFromDebrid: value }),
                  )}
                </div>
              </section>
            `
          : html`<p class="card muted">${t('settings.adminOnly')}</p>`
      }

      <section>
        <h2 class="section-title section-head">${t('settings.account')}</h2>
        <div class="card list">
          <div class="row">
            <span class="row-icon"><dds-icon .path=${mdiNas}></dds-icon></span>
            <div class="row-text">
              <span>${t('settings.connectedAs', { user: session.user.username })}</span>
              <span class="muted small mono ellipsis">${session.nasUrl}</span>
            </div>
          </div>
          ${
            canRegisterMagnetHandler
              ? html`<button class="row action" @click=${this.registerMagnetHandler}>
                  <span class="row-icon"><dds-icon .path=${mdiLinkVariant}></dds-icon></span>
                  <div class="row-text">
                    <span>${t('settings.magnetHandler')}</span>
                    <span class="muted small">${t('settings.magnetHandlerHint')}</span>
                  </div>
                </button>`
              : nothing
          }
          <button class="row action danger" @click=${() => store.logout()}>
            <span class="row-icon"><dds-icon .path=${mdiLogout}></dds-icon></span>
            <div class="row-text"><span>${t('nav.logout')}</span></div>
          </button>
        </div>
      </section>

      <p class="version muted small">
        ${t('app.title')} · ${t('settings.version', { version: session.version })}
      </p>

      <dds-category-dialog
        @save=${(event: CustomEvent<Category>) => this.saveCategory(event.detail)}
        @delete=${(event: CustomEvent<string>) => this.deleteCategory(event.detail)}
      ></dds-category-dialog>
    `;
  }

  private renderCategory(
    category: Category,
    index: number,
    total: number,
    defaultId: string | null,
  ) {
    const isDefault = category.id === defaultId;
    return html`<div class="row category">
      <span class="row-icon accent"
        ><dds-icon .path=${categoryIcon(category.icon)}></dds-icon
      ></span>
      <button class="row-text edit" @click=${() => this.dialog.open(category)}>
        <span class="ellipsis">${category.name}</span>
        <span class="muted small mono ellipsis">${category.destination}</span>
      </button>
      <div class="row-actions">
        <button
          class="icon-btn star ${isDefault ? 'on' : ''}"
          title=${isDefault ? t('settings.default') : t('settings.makeDefault')}
          aria-label=${isDefault ? t('settings.default') : t('settings.makeDefault')}
          aria-pressed=${isDefault}
          ?disabled=${this.saving}
          @click=${() => this.saveSettings({ defaultCategoryId: category.id })}
        >
          <dds-icon .path=${isDefault ? mdiStar : mdiStarOutline}></dds-icon>
        </button>
        <button
          class="icon-btn"
          aria-label=${t('settings.moveUp')}
          ?disabled=${index === 0 || this.saving}
          @click=${() => this.moveCategory(index, -1)}
        >
          <dds-icon .path=${mdiArrowUp}></dds-icon>
        </button>
        <button
          class="icon-btn"
          aria-label=${t('settings.moveDown')}
          ?disabled=${index === total - 1 || this.saving}
          @click=${() => this.moveCategory(index, 1)}
        >
          <dds-icon .path=${mdiArrowDown}></dds-icon>
        </button>
        <button
          class="icon-btn"
          aria-label=${t('settings.edit')}
          @click=${() => this.dialog.open(category)}
        >
          <dds-icon .path=${mdiPencilOutline}></dds-icon>
        </button>
      </div>
    </div>`;
  }

  private renderToggle(
    label: string,
    hint: string,
    checked: boolean,
    onChange: (value: boolean) => void,
  ) {
    return html`<label class="row toggle">
      <div class="row-text">
        <span>${label}</span>
        <span class="muted small">${hint}</span>
      </div>
      <input
        type="checkbox"
        role="switch"
        .checked=${checked}
        ?disabled=${this.saving}
        @change=${(event: Event) => onChange((event.target as HTMLInputElement).checked)}
      />
    </label>`;
  }

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: grid;
        gap: 28px;
      }

      section {
        display: grid;
        gap: 10px;
      }

      .section-head {
        display: grid;
        gap: 4px;
        padding: 0 4px;
      }

      .stack {
        display: grid;
        gap: 20px;
      }

      .stack > * + * {
        padding-top: 20px;
        border-top: 1px solid var(--border);
      }

      .list {
        display: grid;
        padding: 6px 0;
      }

      .row {
        display: flex;
        align-items: center;
        gap: 14px;
        min-height: 60px;
        padding: 8px 16px;
        border: none;
        font: inherit;
        text-align: left;
        color: inherit;
        background: none;
      }

      .row + .row,
      .row + .add-row {
        border-top: 1px solid var(--border);
      }

      .row.action {
        width: 100%;
        cursor: pointer;
      }

      .row.action:hover {
        background: var(--surface-2);
      }

      .row.danger {
        color: var(--danger);
      }

      .row-icon {
        display: grid;
        flex: none;
        place-items: center;
        width: 36px;
        height: 36px;
        border-radius: 10px;
        color: var(--text-2);
        background: var(--surface-2);
      }

      .row-icon.accent {
        color: var(--accent);
        background: var(--accent-soft);
      }

      .row.danger .row-icon {
        color: var(--danger);
        background: var(--danger-soft);
      }

      .row-icon dds-icon {
        --icon-size: 20px;
      }

      .row-text {
        display: grid;
        flex: 1;
        gap: 2px;
        min-width: 0;
      }

      button.row-text {
        padding: 0;
        border: none;
        font: inherit;
        text-align: left;
        color: inherit;
        background: none;
        cursor: pointer;
      }

      .row-actions {
        display: flex;
        margin-right: -8px;
      }

      .row-actions .icon-btn {
        width: 38px;
        height: 38px;
      }

      .row-actions dds-icon {
        --icon-size: 20px;
      }

      .star.on {
        color: #f59e0b;
      }

      @media (max-width: 480px) {
        .category {
          flex-wrap: wrap;
        }

        .category .row-text {
          flex-basis: calc(100% - 50px);
        }

        .category .row-actions {
          width: 100%;
          justify-content: flex-end;
          margin-top: -4px;
        }
      }

      .add-row {
        display: flex;
        align-items: center;
        gap: 14px;
        min-height: 56px;
        padding: 8px 16px;
        border: none;
        font: inherit;
        font-weight: 600;
        color: var(--accent);
        background: none;
        cursor: pointer;
      }

      .add-row:hover {
        background: var(--accent-soft);
      }

      .add-icon {
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border-radius: 10px;
        color: var(--on-accent);
        background: var(--accent-gradient);
      }

      .add-icon dds-icon {
        --icon-size: 20px;
      }

      .toggle {
        cursor: pointer;
      }

      input[role='switch'] {
        position: relative;
        flex: none;
        width: 51px;
        height: 31px;
        margin: 0;
        border-radius: 999px;
        background: var(--surface-3);
        appearance: none;
        -webkit-appearance: none;
        cursor: pointer;
        transition: background-color 0.2s ease;
      }

      input[role='switch']::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 27px;
        height: 27px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        transition: transform 0.2s ease;
      }

      input[role='switch']:checked {
        background: var(--success);
      }

      input[role='switch']:checked::after {
        transform: translateX(20px);
      }

      .version {
        text-align: center;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'dds-settings-page': DdsSettingsPage;
  }
}
