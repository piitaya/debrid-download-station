export interface MagnetInfo {
  /** Normalized magnet URI, safe to hand over to a debrid service. */
  uri: string;
  /** Lowercase hexadecimal info-hash (v1) or multihash (v2), when present. */
  hash: string | null;
  /** Display name (`dn` parameter), when present. */
  name: string | null;
}

const HEX_HASH = /^[0-9a-f]{40}$/i;
const BASE32_HASH = /^[a-z2-7]{32}$/i;
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

function base32ToHex(value: string): string {
  let bits = '';
  for (const char of value.toLowerCase()) {
    bits += BASE32_ALPHABET.indexOf(char).toString(2).padStart(5, '0');
  }
  let hex = '';
  for (let i = 0; i + 4 <= bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

function normalizeInfoHash(value: string): string | null {
  if (HEX_HASH.test(value)) return value.toLowerCase();
  if (BASE32_HASH.test(value)) return base32ToHex(value);
  return null;
}

/** Returns true when the value is a bare BitTorrent v1 info-hash (hex or base32). */
export function isInfoHash(value: string): boolean {
  return normalizeInfoHash(value.trim()) !== null;
}

/** Parses a magnet URI. Returns null when the value is not a usable BitTorrent magnet link. */
export function parseMagnet(value: string): MagnetInfo | null {
  // Links copied from HTML pages sometimes keep their escaped ampersands.
  const input = value.trim().replace(/&amp;/gi, '&');
  if (!/^magnet:\?/i.test(input)) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(input.slice(input.indexOf('?') + 1));
  } catch {
    return null;
  }

  let hash: string | null = null;
  for (const xt of params.getAll('xt')) {
    const v1 = /^urn:btih:(.+)$/i.exec(xt);
    if (v1) {
      hash = normalizeInfoHash(v1[1]!);
      if (hash) break;
    }
    const v2 = /^urn:btmh:([0-9a-f]+)$/i.exec(xt);
    if (v2 && !hash) hash = v2[1]!.toLowerCase();
  }
  if (!hash) return null;

  const name = params.get('dn')?.trim() || null;
  return { uri: input, hash, name };
}

/** Builds a magnet URI from a bare info-hash. */
export function magnetFromHash(hash: string): string | null {
  const normalized = normalizeInfoHash(hash.trim());
  return normalized ? `magnet:?xt=urn:btih:${normalized}` : null;
}

export interface ExtractedMagnets {
  magnets: MagnetInfo[];
  invalid: string[];
}

/**
 * Extracts magnet links (or bare info-hashes) from free text: one per line or separated by
 * spaces. Duplicates (same info-hash) are dropped.
 */
export function extractMagnets(text: string): ExtractedMagnets {
  const magnets: MagnetInfo[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const token of text.split(/\s+/)) {
    if (!token) continue;
    const magnet = parseMagnet(token) ?? parseMagnet(magnetFromHash(token) ?? '');
    if (!magnet) {
      invalid.push(token);
      continue;
    }
    const key = magnet.hash ?? magnet.uri;
    if (seen.has(key)) continue;
    seen.add(key);
    magnets.push(magnet);
  }
  return { magnets, invalid };
}
