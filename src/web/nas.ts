import type { ErrorCode, ErrorInfo } from '../shared/types.js';
import { errorMessage, t } from './i18n.js';

/** Errors where what the NAS said helps: a wrong address, a certificate… */
const TECHNICAL_ERRORS: ReadonlySet<ErrorCode> = new Set([
  'nas_unreachable',
  'nas_certificate',
  'nas_error',
]);

/** An error of a DSM login, with the NAS's own message when it helps. */
export function describeNasError(error: ErrorInfo): { text: string; detail: string } {
  const detail =
    TECHNICAL_ERRORS.has(error.code) && error.message
      ? t('common.detail', { message: error.message })
      : '';
  return { text: errorMessage(error.code), detail };
}

export const isHttps = (url: string): boolean => /^\s*https:/i.test(url);

/** The NAS usually is where the app runs: its address, on DSM's port. */
export function guessNasUrl(): string {
  const host = location.hostname;
  const local =
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.endsWith('.local') || !host.includes('.');
  return local && host !== 'localhost' ? `http://${host}:5000` : '';
}
