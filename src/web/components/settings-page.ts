import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';

/** Placeholder: replaced by the settings screen. */
@customElement('dds-settings-page')
export class DdsSettingsPage extends LitElement {
  override render() {
    return html``;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dds-settings-page': DdsSettingsPage;
  }
}
