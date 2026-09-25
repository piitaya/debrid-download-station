import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROVIDER_IDS, type ProviderId } from '../shared/types.js';

export interface Env {
  port: number;
  host: string;
  dataDir: string;
  webRoot: string;
  version: string;
  /** Base URL of DSM, without trailing slash (`http://192.168.1.10:5000`). */
  synologyUrl: string | null;
  /** Accept self-signed certificates when talking to DSM over HTTPS. */
  synologyInsecureTls: boolean;
  /** Lowercase DSM usernames allowed to log in. Empty: any DSM user. */
  allowedUsers: string[];
  /** Lowercase DSM usernames allowed to change the settings. Empty: every logged-in user. */
  adminUsers: string[];
  sessionTtlDays: number;
  /** Trust `X-Forwarded-*` headers set by a reverse proxy. */
  trustProxy: boolean;
  /** API keys set through the environment (they take precedence over the UI settings). */
  providerKeys: Partial<Record<ProviderId, string>>;
  /** Base URLs of the debrid APIs (overridable for tests). */
  providerUrls: Record<ProviderId, string>;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[,;\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function normalizeSynologyUrl(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const url = new URL(withScheme);
    return trimSlash(`${url.protocol}//${url.host}${url.pathname}`);
  } catch {
    return null;
  }
}

const bundled = import.meta.url.endsWith('/dist/server/index.js');

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const production = source.NODE_ENV === 'production';
  const providerKeys: Partial<Record<ProviderId, string>> = {};
  for (const id of PROVIDER_IDS) {
    const key = source[`${id.toUpperCase()}_API_KEY`]?.trim();
    if (key) providerKeys[id] = key;
  }
  const logLevel = source.LOG_LEVEL?.trim().toLowerCase();

  return {
    port: int(source.PORT, 8080, 1, 65535),
    host: source.HOST?.trim() || '0.0.0.0',
    dataDir: resolve(source.DATA_DIR?.trim() || (production ? '/data' : './data')),
    webRoot: resolve(
      source.WEB_ROOT?.trim() ||
        (bundled ? fileURLToPath(new URL('../web/', import.meta.url)) : './dist/web'),
    ),
    version:
      typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : (source.npm_package_version ?? 'dev'),
    synologyUrl: normalizeSynologyUrl(source.SYNOLOGY_URL),
    synologyInsecureTls: bool(source.SYNOLOGY_INSECURE_TLS, false),
    allowedUsers: list(source.ALLOWED_USERS),
    adminUsers: list(source.ADMIN_USERS),
    sessionTtlDays: int(source.SESSION_TTL_DAYS, 30, 1, 365),
    trustProxy: bool(source.TRUST_PROXY, false),
    providerKeys,
    providerUrls: {
      alldebrid: trimSlash(source.ALLDEBRID_API_URL?.trim() || 'https://api.alldebrid.com'),
      realdebrid: trimSlash(source.REALDEBRID_API_URL?.trim() || 'https://api.real-debrid.com'),
      torbox: trimSlash(source.TORBOX_API_URL?.trim() || 'https://api.torbox.app'),
    },
    logLevel:
      logLevel === 'debug' || logLevel === 'warn' || logLevel === 'error' ? logLevel : 'info',
  };
}
