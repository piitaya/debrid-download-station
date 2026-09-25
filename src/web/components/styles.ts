import { css } from 'lit';

/** Building blocks shared by every component (they live in shadow roots). */
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
  p {
    margin: 0;
  }

  a {
    color: var(--accent);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }

  :focus-visible {
    outline: 3px solid var(--accent-soft);
    outline-offset: 2px;
  }

  .card {
    background: var(--surface);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
    padding: 20px;
  }

  .section-title {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-2);
  }

  .muted {
    color: var(--text-2);
  }

  .small {
    font-size: 13px;
  }

  .ellipsis {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mono {
    font-family: var(--font-mono);
    font-size: 0.92em;
  }

  /* Buttons */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 44px;
    padding: 0 18px;
    border: none;
    border-radius: 12px;
    font: inherit;
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
    background: var(--surface-2);
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    transition:
      transform 0.12s ease,
      background-color 0.2s ease,
      opacity 0.2s ease,
      box-shadow 0.2s ease;
    white-space: nowrap;
  }

  .btn:hover {
    background: var(--surface-3);
  }

  .btn:active:not(:disabled) {
    transform: scale(0.97);
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .btn dds-icon {
    --icon-size: 20px;
  }

  .btn-primary {
    color: var(--on-accent);
    background: var(--accent-gradient);
    box-shadow: 0 8px 20px -8px rgba(99, 102, 241, 0.7);
  }

  .btn-primary:hover {
    background: var(--accent-gradient);
    box-shadow: 0 10px 24px -8px rgba(99, 102, 241, 0.85);
  }

  .btn-primary:disabled {
    box-shadow: none;
  }

  .btn-ghost {
    background: transparent;
    color: var(--accent);
  }

  .btn-ghost:hover {
    background: var(--accent-soft);
  }

  .btn-danger {
    background: var(--danger-soft);
    color: var(--danger);
  }

  .btn-danger:hover {
    background: var(--danger-soft);
    filter: saturate(1.4);
  }

  .btn-block {
    width: 100%;
  }

  .btn-lg {
    min-height: 52px;
    font-size: 17px;
    border-radius: 14px;
  }

  .btn-sm {
    min-height: 36px;
    padding: 0 12px;
    font-size: 14px;
    border-radius: 10px;
  }

  .icon-btn {
    display: inline-grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: none;
    border-radius: 50%;
    color: var(--text-2);
    background: transparent;
    cursor: pointer;
    transition:
      background-color 0.2s ease,
      color 0.2s ease;
  }

  .icon-btn:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .icon-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  /* Form fields */
  label.field {
    display: grid;
    gap: 6px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-2);
  }

  .input,
  textarea.input {
    width: 100%;
    min-height: 48px;
    padding: 12px 14px;
    border: 1.5px solid transparent;
    border-radius: 12px;
    font: inherit;
    /* 16px prevents iOS Safari from zooming on focus. */
    font-size: 16px;
    color: var(--text);
    background: var(--surface-2);
    outline: none;
    transition:
      border-color 0.2s ease,
      box-shadow 0.2s ease,
      background-color 0.2s ease;
  }

  .input::placeholder {
    color: var(--text-3);
  }

  .input:focus {
    border-color: var(--accent);
    background: var(--surface);
    box-shadow: 0 0 0 4px var(--accent-soft);
  }

  /* Chips */
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 0 16px 0 12px;
    border: none;
    border-radius: 999px;
    font: inherit;
    font-size: 15px;
    font-weight: 500;
    color: var(--text);
    background: var(--surface-2);
    cursor: pointer;
    transition:
      background-color 0.2s ease,
      color 0.2s ease,
      transform 0.12s ease,
      box-shadow 0.2s ease;
  }

  .chip dds-icon {
    --icon-size: 19px;
    color: var(--text-2);
    transition: color 0.2s ease;
  }

  .chip:hover {
    background: var(--surface-3);
  }

  .chip:active {
    transform: scale(0.96);
  }

  .chip[aria-pressed='true'] {
    color: var(--on-accent);
    background: var(--accent);
    box-shadow: 0 6px 16px -8px var(--accent);
  }

  .chip[aria-pressed='true'] dds-icon {
    color: var(--on-accent);
  }

  /* Segmented control */
  .segmented {
    display: flex;
    gap: 4px;
    padding: 4px;
    border-radius: 13px;
    background: var(--surface-2);
  }

  .segmented button {
    flex: 1;
    min-height: 36px;
    padding: 0 10px;
    border: none;
    border-radius: 10px;
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-2);
    background: transparent;
    cursor: pointer;
    transition:
      background-color 0.2s ease,
      color 0.2s ease,
      box-shadow 0.2s ease;
  }

  .segmented button[aria-pressed='true'] {
    color: var(--text);
    background: var(--surface);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  }

  /* Badges */
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-2);
    background: var(--surface-2);
    white-space: nowrap;
  }

  .badge dds-icon {
    --icon-size: 14px;
  }

  .badge.success {
    color: var(--success);
    background: var(--success-soft);
  }

  .badge.warning {
    color: var(--warning);
    background: var(--warning-soft);
  }

  .badge.danger {
    color: var(--danger);
    background: var(--danger-soft);
  }

  .badge.accent {
    color: var(--accent);
    background: var(--accent-soft);
  }

  /* Progress bar */
  .progress {
    position: relative;
    height: 6px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--surface-3);
  }

  .progress > span {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: inherit;
    background: var(--accent-gradient);
    transition: width 0.6s ease;
  }

  .progress.indeterminate > span {
    width: 35%;
    animation: indeterminate 1.4s ease-in-out infinite;
  }

  @keyframes indeterminate {
    from {
      left: -35%;
    }
    to {
      left: 100%;
    }
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 2.5px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .error-box {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 12px 14px;
    border-radius: 12px;
    font-size: 14px;
    color: var(--danger);
    background: var(--danger-soft);
  }

  .error-box dds-icon {
    --icon-size: 20px;
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

/** Native <dialog>: bottom sheet on phones, centered card on larger screens. */
export const dialogStyles = css`
  dialog {
    width: 100%;
    max-width: 100%;
    max-height: calc(100dvh - 48px);
    margin: auto 0 0;
    padding: 0;
    border: none;
    border-radius: 24px 24px 0 0;
    color: var(--text);
    background: var(--surface);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }

  dialog[open] {
    display: flex;
    flex-direction: column;
    animation: sheet-in 0.3s cubic-bezier(0.2, 0.9, 0.3, 1);
  }

  dialog::backdrop {
    background: rgba(10, 10, 20, 0.45);
    -webkit-backdrop-filter: blur(4px);
    backdrop-filter: blur(4px);
  }

  @keyframes sheet-in {
    from {
      transform: translateY(40px);
      opacity: 0;
    }
  }

  .dialog-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 16px 12px 8px 20px;
  }

  .dialog-head h2 {
    flex: 1;
    font-size: 18px;
    font-weight: 700;
  }

  .dialog-body {
    display: grid;
    gap: 16px;
    padding: 8px 20px 20px;
    overflow-y: auto;
  }

  .dialog-foot {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 12px 20px calc(16px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--border);
  }

  .dialog-foot .spacer {
    flex: 1;
  }

  @media (min-width: 640px) {
    dialog {
      width: min(520px, calc(100% - 48px));
      margin: auto;
      border-radius: 24px;
    }

    dialog[open] {
      animation-name: dialog-in;
    }

    .dialog-foot {
      padding-bottom: 16px;
    }

    @keyframes dialog-in {
      from {
        transform: scale(0.96);
        opacity: 0;
      }
    }
  }
`;
