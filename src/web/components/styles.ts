import { css } from 'lit';

/*
 * Shared building blocks (components live in shadow roots, so every component includes
 * `sharedStyles`). Visual rules: one accent colour, flat surfaces, no gradients, hairline
 * separators, 8px spacing grid.
 */
export const sharedStyles = css`
  :host {
    display: block;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  [hidden] {
    display: none !important;
  }

  h1,
  h2,
  h3,
  p,
  ul {
    margin: 0;
  }

  ul {
    padding: 0;
    list-style: none;
  }

  a {
    color: var(--accent);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }

  button {
    font: inherit;
    color: inherit;
  }

  :focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  /* Text */
  .secondary {
    color: var(--text-secondary);
  }

  .tertiary {
    color: var(--text-tertiary);
  }

  .small {
    font-size: 13px;
  }

  .danger-text {
    color: var(--danger);
  }

  .success-text {
    color: var(--success);
  }

  .warning-text {
    color: var(--warning);
  }

  .mono {
    font-family: var(--font-mono);
    font-size: 0.9em;
  }

  .num {
    font-variant-numeric: tabular-nums;
  }

  .ellipsis {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .wrap {
    overflow-wrap: anywhere;
  }

  /* Buttons */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: var(--control-height);
    padding: 0 14px;
    border: none;
    border-radius: var(--radius);
    font-size: 15px;
    font-weight: 600;
    line-height: 1;
    color: var(--text);
    background: var(--fill);
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    white-space: nowrap;
    transition:
      background-color 0.15s ease,
      opacity 0.15s ease;
  }

  .btn:hover {
    background: var(--fill-hover);
  }

  .btn:active {
    background: var(--fill-pressed);
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: default;
    pointer-events: none;
  }

  .btn dds-icon {
    --icon-size: 18px;
  }

  .btn-primary {
    color: var(--text-on-accent);
    background: var(--accent);
  }

  .btn-primary:hover,
  .btn-primary:active {
    background: var(--accent-pressed);
  }

  .btn-primary:disabled {
    color: var(--text-tertiary);
    background: var(--fill);
    opacity: 1;
  }

  .btn-plain {
    color: var(--accent);
    background: transparent;
  }

  .btn-plain:hover {
    background: var(--accent-fill);
  }

  .btn-plain:active {
    background: var(--accent-fill);
    opacity: 0.8;
  }

  .btn-destructive {
    color: var(--danger);
    background: transparent;
  }

  .btn-destructive:hover,
  .btn-destructive:active {
    background: var(--danger-fill);
  }

  .btn-sm {
    min-height: 30px;
    padding: 0 10px;
    font-size: 13px;
    border-radius: var(--radius-sm);
  }

  .btn-block {
    width: 100%;
  }

  .icon-btn {
    display: inline-grid;
    flex: none;
    place-items: center;
    width: var(--control-height);
    height: var(--control-height);
    padding: 0;
    border: none;
    border-radius: var(--radius);
    color: var(--text-secondary);
    background: transparent;
    cursor: pointer;
    transition: background-color 0.15s ease;
  }

  .icon-btn:hover {
    background: var(--fill);
  }

  .icon-btn:active {
    background: var(--fill-hover);
  }

  .icon-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .icon-btn.accent {
    color: var(--accent);
  }

  .icon-btn dds-icon {
    --icon-size: 20px;
  }

  /* Form fields */
  .field {
    display: block;
    width: 100%;
    min-height: var(--control-height);
    padding: 8px 12px;
    border: none;
    border-radius: var(--radius);
    font: inherit;
    /* 16px keeps iOS Safari from zooming in on focus. */
    font-size: 16px;
    color: var(--text);
    background: var(--fill);
    outline: none;
    transition: box-shadow 0.15s ease;
  }

  .field::placeholder {
    color: var(--text-tertiary);
  }

  .field:focus {
    box-shadow: var(--focus-ring);
  }

  textarea.field {
    resize: vertical;
    line-height: 1.4;
  }

  @media (pointer: fine) {
    .field {
      font-size: 15px;
    }
  }

  .label {
    display: block;
    margin-bottom: 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
  }

  /* Grouped lists (iOS settings style) */
  .section + .section {
    margin-top: 28px;
  }

  .section-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    min-height: 24px;
    padding: 0 16px 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
  }

  /* Keeps a finger-sized target without growing the header. */
  .section-header .btn-plain {
    min-height: 36px;
    margin: -10px -10px -10px 0;
    padding: 0 10px;
    font-size: 15px;
    font-weight: 400;
  }

  .section-footer {
    padding: 6px 16px 0;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .group {
    overflow: hidden;
    border-radius: var(--radius-lg);
    background: var(--bg-elevated);
  }

  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: var(--row-height);
    padding: 8px 16px;
    border: none;
    font: inherit;
    text-align: left;
    color: inherit;
    background: transparent;
    text-decoration: none;
  }

  /* Hairline separators, inset to the text column. */
  .row + .row::before {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    left: var(--separator-inset, 16px);
    height: 1px;
    background: var(--separator);
    transform: scaleY(0.5);
    transform-origin: top;
  }

  .group.with-icons {
    --separator-inset: 56px;
  }

  button.row,
  a.row,
  label.row {
    cursor: pointer;
  }

  button.row:hover,
  a.row:hover,
  label.row:hover {
    background: var(--fill);
    text-decoration: none;
  }

  button.row:active,
  a.row:active {
    background: var(--fill-hover);
  }

  button.row:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .row-icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 7px;
    color: var(--text-secondary);
    background: var(--fill);
  }

  .row-icon dds-icon {
    --icon-size: 18px;
  }

  .row-icon.accent {
    color: var(--text-on-accent);
    background: var(--accent);
  }

  .row-main {
    display: grid;
    flex: 1;
    gap: 1px;
    min-width: 0;
  }

  .row-title {
    font-size: 15px;
  }

  .row-subtitle {
    font-size: 13px;
    color: var(--text-secondary);
  }

  .row-value {
    flex: none;
    max-width: 50%;
    font-size: 15px;
    color: var(--text-secondary);
  }

  .chevron {
    --icon-size: 18px;
    flex: none;
    margin-right: -4px;
    color: var(--text-tertiary);
  }

  .check {
    --icon-size: 20px;
    flex: none;
    color: var(--accent);
  }

  .row.destructive {
    justify-content: center;
    color: var(--danger);
  }

  .row.action {
    justify-content: center;
    color: var(--accent);
  }

  /* Segmented control */
  .segmented {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: 9px;
    background: var(--fill);
  }

  .segmented button {
    flex: 1;
    min-height: 30px;
    padding: 0 12px;
    border: none;
    border-radius: 7px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
    background: transparent;
    cursor: pointer;
  }

  .segmented button[aria-pressed='true'] {
    font-weight: 600;
    background: var(--bg-elevated);
    box-shadow: var(--shadow-control);
  }

  /* Switch */
  input.switch {
    position: relative;
    flex: none;
    width: 44px;
    height: 26px;
    margin: 0;
    border-radius: 13px;
    background: var(--fill-pressed);
    appearance: none;
    -webkit-appearance: none;
    cursor: pointer;
    transition: background-color 0.2s ease;
  }

  input.switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    transition: transform 0.2s ease;
  }

  input.switch:checked {
    background: var(--accent);
  }

  input.switch:checked::after {
    transform: translateX(18px);
  }

  input.switch:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* Progress */
  .progress {
    position: relative;
    height: 4px;
    overflow: hidden;
    border-radius: 2px;
    background: var(--fill);
  }

  .progress > span {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: inherit;
    background: var(--accent);
    transition: width 0.4s ease;
  }

  .progress.indeterminate > span {
    width: 30%;
    animation: indeterminate 1.2s ease-in-out infinite;
  }

  @keyframes indeterminate {
    from {
      left: -30%;
    }
    to {
      left: 100%;
    }
  }

  .spinner {
    width: 18px;
    height: 18px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Inline notice (errors, warnings) */
  .notice {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 10px 12px;
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--danger);
    background: var(--danger-fill);
  }

  .notice dds-icon {
    --icon-size: 18px;
    flex: none;
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
`;
