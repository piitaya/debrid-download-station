import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/** The app icon (same drawing as public/icons/icon.svg). */
@customElement('dds-logo')
export class DdsLogo extends LitElement {
  @property({ type: Number }) size = 40;

  static override styles = css`
    :host {
      display: inline-flex;
    }

    svg {
      display: block;
      filter: drop-shadow(0 6px 14px rgba(99, 102, 241, 0.35));
    }
  `;

  override render() {
    return html`<svg
      width=${this.size}
      height=${this.size}
      viewBox="0 0 512 512"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#6366f1" />
          <stop offset=".55" stop-color="#8b5cf6" />
          <stop offset="1" stop-color="#d946ef" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill="url(#g)" />
      <path d="M128 300v-64a128 128 0 0 1 256 0v64h-68v-64a60 60 0 0 0-120 0v64z" fill="#fff" />
      <rect x="128" y="314" width="68" height="46" rx="12" fill="#fff" fill-opacity=".7" />
      <rect x="316" y="314" width="68" height="46" rx="12" fill="#fff" fill-opacity=".7" />
      <path
        d="M256 262v128m-44-44 44 44 44-44"
        fill="none"
        stroke="#fff"
        stroke-width="30"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dds-logo': DdsLogo;
  }
}
