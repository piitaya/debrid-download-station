import { createHash } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { parseMagnet } from '../../src/shared/magnet.js';
import { parseTorrent } from '../../src/shared/torrent.js';

/*
 * Fake AllDebrid, Real-Debrid and TorBox APIs (same shapes as the real ones), with simulated
 * downloads. The torrent name drives the behaviour:
 *  - "dead"          → the service fails to fetch it
 *  - "slow"          → takes 45 seconds at the debrid service
 *  - "S01" / "pack"  → a season pack (4 episodes + subtitles)
 *  - "2160p"/"1080p" → bigger files
 */

export interface MockTorrent {
  id: string;
  hash: string;
  name: string;
  files: { path: string; size: number }[];
  multiFile: boolean;
  createdAt: number;
  /** Milliseconds before the torrent is ready. */
  duration: number;
  dead: boolean;
  deleted: boolean;
  /** Real-Debrid: file ids picked with selectFiles. */
  selected: number[] | null;
}

const GB = 1024 ** 3;
const MB = 1024 ** 2;

function sizeFor(name: string): number {
  if (/2160p|4k/i.test(name)) return Math.round(7.8 * GB);
  if (/1080p/i.test(name)) return Math.round(2.4 * GB);
  return 350 * MB;
}

function contentFor(name: string): Pick<MockTorrent, 'files' | 'multiFile'> {
  if (/\bS\d{2}\b|S\d{2}(?!E)|pack/i.test(name)) {
    const show = name.replace(/\.(S\d{2}).*/i, '');
    const files = [1, 2, 3, 4].map((n) => ({
      path: `${show}.S01E0${n}.1080p.WEB.mkv`,
      size: Math.round(1.1 * GB) + n * 7 * MB,
    }));
    files.push({ path: 'Subs/English.srt', size: 48_000 });
    return { files, multiFile: true };
  }
  const file = /\.(mkv|mp4|avi|iso)$/i.test(name) ? name : `${name}.mkv`;
  return { files: [{ path: file, size: sizeFor(name) }], multiFile: false };
}

export function createMockDebrid(options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const torrents = new Map<string, MockTorrent>();
  let counter = 1000;

  const add = (name: string, hash: string, files?: MockTorrent['files'], multiFile?: boolean) => {
    const id = String(++counter);
    const content = files ? { files, multiFile: multiFile ?? files.length > 1 } : contentFor(name);
    const torrent: MockTorrent = {
      id,
      hash,
      name,
      ...content,
      createdAt: now(),
      duration: /slow/i.test(name) ? 45_000 : 1500,
      dead: /dead/i.test(name),
      deleted: false,
      selected: null,
    };
    torrents.set(id, torrent);
    return torrent;
  };

  const fromMagnet = (magnet: string) => {
    const info = parseMagnet(magnet);
    if (!info) return null;
    return add(info.name ?? `noname-${info.hash?.slice(0, 8)}`, info.hash ?? '');
  };

  const fromTorrentFile = async (file: File) => {
    const data = new Uint8Array(await file.arrayBuffer());
    const meta = parseTorrent(data);
    const hash = createHash('sha1')
      .update(data.subarray(...meta.infoRange))
      .digest('hex');
    const multiFile = meta.files.length > 1 || meta.files[0]?.path !== meta.name;
    return add(meta.name, hash, meta.files, multiFile);
  };

  const progress = (torrent: MockTorrent) =>
    Math.min(1, (now() - torrent.createdAt) / Math.max(1, torrent.duration));
  /** Fetching metadata: the first half second. */
  const starting = (torrent: MockTorrent) => now() - torrent.createdAt < 500;
  const totalSize = (torrent: MockTorrent) => torrent.files.reduce((sum, f) => sum + f.size, 0);
  const origin = (c: Context) => new URL(c.req.url).origin;
  const fileName = (path: string) => path.split('/').pop()!;
  const directLink = (c: Context, provider: string, torrent: MockTorrent, index: number) => {
    const file = torrent.files[index]!;
    return `${origin(c)}/cdn/${provider}/${torrent.id}/${encodeURIComponent(fileName(file.path))}?size=${file.size}`;
  };
  const bearer = (c: Context) => c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const live = (id: string | undefined) => {
    const torrent = id ? torrents.get(id) : undefined;
    return torrent && !torrent.deleted ? torrent : null;
  };

  const app = new Hono();

  // ---------------------------------------------------------------- AllDebrid
  const ad = new Hono();
  const adOk = (c: Context, data: unknown) => c.json({ status: 'success', data });
  const adError = (c: Context, code: string, message = code) =>
    c.json({ status: 'error', error: { code, message } });

  ad.use('*', async (c, next) => {
    if (bearer(c) === 'bad') return adError(c, 'AUTH_BAD_APIKEY', 'The auth apikey is invalid');
    await next();
  });
  ad.post('/v4/user', (c) =>
    adOk(c, {
      user: {
        username: 'demo-alldebrid',
        isPremium: true,
        premiumUntil: Math.floor(now() / 1000) + 142 * 86400,
      },
    }),
  );
  ad.post('/v4/magnet/upload', async (c) => {
    const body = await c.req.parseBody({ all: true });
    const values = [body['magnets[]']].flat().filter((v): v is string => typeof v === 'string');
    return adOk(c, {
      magnets: values.map((magnet) => {
        const torrent = fromMagnet(magnet);
        if (!torrent)
          return { magnet, error: { code: 'MAGNET_INVALID_URI', message: 'Magnet is not valid' } };
        return {
          magnet,
          hash: torrent.hash,
          name: torrent.name,
          size: totalSize(torrent),
          ready: false,
          id: Number(torrent.id),
        };
      }),
    });
  });
  ad.post('/v4/magnet/upload/file', async (c) => {
    const body = await c.req.parseBody({ all: true });
    const files = [body['files[]']].flat().filter((v): v is File => v instanceof File);
    const results = [];
    for (const file of files) {
      try {
        const torrent = await fromTorrentFile(file);
        results.push({
          file: file.name,
          name: torrent.name,
          size: totalSize(torrent),
          hash: torrent.hash,
          ready: false,
          id: Number(torrent.id),
        });
      } catch {
        results.push({
          file: file.name,
          error: { code: 'MAGNET_INVALID_FILE', message: 'File is not a valid torrent' },
        });
      }
    }
    return adOk(c, { files: results });
  });
  ad.post('/v4/magnet/status', (c) =>
    c.json({ status: 'error', error: { code: 'DISCONTINUED' }, deprecated: true }),
  );
  ad.post('/v4.1/magnet/status', async (c) => {
    const body = await c.req.parseBody();
    const torrent = live(String(body.id));
    if (!torrent) return adError(c, 'MAGNET_INVALID_ID');
    const size = totalSize(torrent);
    const p = progress(torrent);
    const base = {
      id: Number(torrent.id),
      filename: torrent.name,
      size,
      hash: torrent.hash,
      seeders: 0,
    };
    if (torrent.dead && p >= 0.5)
      return adOk(c, {
        magnets: { ...base, status: 'File not available - no peer', statusCode: 15 },
      });
    if (p >= 1)
      return adOk(c, {
        magnets: { ...base, status: 'Ready', statusCode: 4, nbLinks: torrent.files.length },
      });
    if (starting(torrent))
      return adOk(c, { magnets: { ...base, status: 'In Queue', statusCode: 0 } });
    return adOk(c, {
      magnets: {
        ...base,
        status: 'Downloading',
        statusCode: 1,
        downloaded: Math.floor(size * p),
        seeders: 23,
        downloadSpeed: 14 * MB,
      },
    });
  });
  ad.post('/v4/magnet/files', async (c) => {
    const body = await c.req.parseBody({ all: true });
    const ids = [body['id[]']].flat().map(String);
    return adOk(c, {
      magnets: ids.map((id) => {
        const torrent = live(id);
        if (!torrent) return { id, error: { code: 'MAGNET_INVALID_ID', message: 'Invalid id' } };
        // Tree nodes: { n, s, l } for files, { n, e } for folders.
        const root: { n: string; e?: unknown[] }[] = [];
        torrent.files.forEach((file, index) => {
          const parts = file.path.split('/');
          let level = root as { n: string; e?: unknown[] }[];
          for (const part of parts.slice(0, -1)) {
            let folder = level.find((node) => node.n === part && node.e);
            if (!folder) {
              folder = { n: part, e: [] };
              level.push(folder);
            }
            level = folder.e as { n: string; e?: unknown[] }[];
          }
          level.push({
            n: parts.at(-1)!,
            s: file.size,
            l: `https://alldebrid.com/f/${torrent.id}-${index}`,
          } as never);
        });
        return { id, files: torrent.multiFile ? [{ n: torrent.name, e: root }] : root };
      }),
    });
  });
  ad.post('/v4/link/unlock', async (c) => {
    const body = await c.req.parseBody();
    const match = /\/f\/(\d+)-(\d+)$/.exec(String(body.link));
    const torrent = match ? live(match[1]) : null;
    if (!match || !torrent) return adError(c, 'LINK_DOWN');
    const file = torrent.files[Number(match[2])]!;
    return adOk(c, {
      link: directLink(c, 'alldebrid', torrent, Number(match[2])),
      filename: fileName(file.path),
      filesize: file.size,
    });
  });
  ad.post('/v4/magnet/delete', async (c) => {
    const body = await c.req.parseBody();
    const torrent = live(String(body.id));
    if (!torrent) return adError(c, 'MAGNET_INVALID_ID');
    torrent.deleted = true;
    return adOk(c, { message: 'Magnet was successfully deleted' });
  });
  app.route('/alldebrid', ad);

  // -------------------------------------------------------------- Real-Debrid
  const rd = new Hono();
  const rdError = (c: Context, status: 400 | 401 | 404, error: string, code: number) =>
    c.json({ error, error_code: code }, status);
  rd.use('*', async (c, next) => {
    if (bearer(c) === 'bad') return rdError(c, 401, 'bad_token', 8);
    await next();
  });
  rd.get('/rest/1.0/user', (c) =>
    c.json({
      id: 1,
      username: 'demo-realdebrid',
      email: 'demo@example.com',
      type: 'premium',
      premium: 90 * 86400,
      expiration: new Date(now() + 90 * 86400_000).toISOString(),
    }),
  );
  rd.get('/rest/1.0/torrents', (c) =>
    c.json(
      [...torrents.values()]
        .filter((t) => !t.deleted)
        .map((t) => ({
          id: t.id,
          hash: t.hash,
          filename: t.name,
          status: t.dead ? 'dead' : progress(t) >= 1 ? 'downloaded' : 'downloading',
        })),
    ),
  );
  rd.post('/rest/1.0/torrents/addMagnet', async (c) => {
    const body = await c.req.parseBody();
    const torrent = fromMagnet(String(body.magnet ?? ''));
    if (!torrent) return rdError(c, 400, 'parameter_invalid_value', 2);
    return c.json(
      { id: torrent.id, uri: `${origin(c)}/rest/1.0/torrents/info/${torrent.id}` },
      201,
    );
  });
  rd.put('/rest/1.0/torrents/addTorrent', async (c) => {
    try {
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      const torrent = await fromTorrentFile(new File([bytes], 'x.torrent'));
      return c.json({ id: torrent.id, uri: '' }, 201);
    } catch {
      return rdError(c, 400, 'upload_error', 30);
    }
  });
  const rdFiles = (torrent: MockTorrent) =>
    torrent.files.map((file, index) => ({
      id: index + 1,
      path: `/${file.path}`,
      bytes: file.size,
      selected: torrent.selected?.includes(index + 1) ? 1 : 0,
    }));
  rd.get('/rest/1.0/torrents/info/:id', (c) => {
    const torrent = live(c.req.param('id'));
    if (!torrent) return rdError(c, 404, 'unknown_ressource', 7);
    const base = {
      id: torrent.id,
      filename: torrent.name,
      original_filename: torrent.name,
      hash: torrent.hash,
      bytes: totalSize(torrent),
      original_bytes: totalSize(torrent),
      host: 'real-debrid.com',
      split: 2000,
      added: new Date(torrent.createdAt).toISOString(),
    };
    const p = progress(torrent);
    if (starting(torrent))
      return c.json({
        ...base,
        filename: 'Magnet',
        status: 'magnet_conversion',
        progress: 0,
        files: [],
        links: [],
      });
    if (!torrent.selected)
      return c.json({
        ...base,
        status: 'waiting_files_selection',
        progress: 0,
        files: rdFiles(torrent),
        links: [],
      });
    if (torrent.dead)
      return c.json({ ...base, status: 'dead', progress: 0, files: rdFiles(torrent), links: [] });
    if (p < 1) {
      return c.json({
        ...base,
        status: 'downloading',
        progress: Math.round(p * 1000) / 10,
        speed: 21 * MB,
        seeders: 41,
        files: rdFiles(torrent),
        links: [],
      });
    }
    return c.json({
      ...base,
      status: 'downloaded',
      progress: 100,
      files: rdFiles(torrent),
      links: torrent.selected.map((fileId) => `https://real-debrid.com/d/${torrent.id}X${fileId}`),
    });
  });
  rd.post('/rest/1.0/torrents/selectFiles/:id', async (c) => {
    const torrent = live(c.req.param('id'));
    if (!torrent) return rdError(c, 404, 'unknown_ressource', 7);
    const body = await c.req.parseBody();
    const files = String(body.files ?? '');
    torrent.selected =
      files === 'all' ? torrent.files.map((_, i) => i + 1) : files.split(',').map(Number);
    return c.body(null, 204);
  });
  rd.post('/rest/1.0/unrestrict/link', async (c) => {
    const body = await c.req.parseBody();
    const match = /\/d\/(\d+)X(\d+)$/.exec(String(body.link));
    const torrent = match ? live(match[1]) : null;
    if (!match || !torrent) return rdError(c, 404, 'unknown_ressource', 7);
    const index = Number(match[2]) - 1;
    const file = torrent.files[index]!;
    return c.json({
      id: `${torrent.id}X${match[2]}`,
      filename: fileName(file.path),
      filesize: file.size,
      link: String(body.link),
      host: 'real-debrid.com',
      download: directLink(c, 'realdebrid', torrent, index),
      streamable: 1,
    });
  });
  rd.delete('/rest/1.0/torrents/delete/:id', (c) => {
    const torrent = live(c.req.param('id'));
    if (!torrent) return rdError(c, 404, 'unknown_ressource', 7);
    torrent.deleted = true;
    return c.body(null, 204);
  });
  app.route('/realdebrid', rd);

  // ------------------------------------------------------------------- TorBox
  const tb = new Hono();
  const tbOk = (c: Context, data: unknown, detail = 'OK') =>
    c.json({ success: true, error: null, detail, data });
  const tbError = (c: Context, status: 400 | 403 | 500, error: string, detail = error) =>
    c.json({ success: false, error, detail, data: null }, status);
  tb.use('*', async (c, next) => {
    const token = bearer(c) || c.req.query('token') || '';
    if (token === 'bad') return tbError(c, 403, 'BAD_TOKEN', 'Invalid API token');
    await next();
  });
  tb.get('/v1/api/user/me', (c) =>
    tbOk(c, {
      id: 1,
      email: 'demo@torbox.example',
      plan: 2,
      is_subscribed: true,
      premium_expires_at: new Date(now() + 60 * 86400_000).toISOString(),
    }),
  );
  tb.post('/v1/api/torrents/createtorrent', async (c) => {
    const body = await c.req.parseBody();
    let torrent: MockTorrent | null = null;
    try {
      if (body.file instanceof File) torrent = await fromTorrentFile(body.file);
      else if (typeof body.magnet === 'string') torrent = fromMagnet(body.magnet);
    } catch {
      return tbError(c, 400, 'BOZO_TORRENT', 'Invalid torrent');
    }
    if (!torrent)
      return tbError(
        c,
        400,
        'MISSING_REQUIRED_OPTION',
        'You must provide either a file or magnet link.',
      );
    return tbOk(
      c,
      { torrent_id: Number(torrent.id), hash: torrent.hash, auth_id: 'x' },
      'Torrent created successfully.',
    );
  });
  const tbTorrent = (torrent: MockTorrent) => {
    const p = progress(torrent);
    const ready = p >= 1 && !torrent.dead;
    return {
      id: Number(torrent.id),
      hash: torrent.hash,
      name: torrent.name,
      size: totalSize(torrent),
      download_state:
        torrent.dead && p >= 0.5
          ? 'error'
          : ready
            ? 'cached'
            : starting(torrent)
              ? 'metaDL'
              : 'downloading',
      progress: ready ? 1 : p,
      download_speed: ready ? 0 : 17 * MB,
      seeds: 17,
      download_finished: ready,
      download_present: ready,
      files: torrent.files.map((file, index) => ({
        id: index,
        name: torrent.multiFile ? `${torrent.name}/${file.path}` : file.path,
        short_name: fileName(file.path),
        size: file.size,
      })),
    };
  };
  tb.get('/v1/api/torrents/mylist', (c) => {
    const id = c.req.query('id');
    if (id) {
      const torrent = live(id);
      return torrent ? tbOk(c, tbTorrent(torrent)) : tbError(c, 500, 'DATABASE_ERROR');
    }
    return tbOk(c, [...torrents.values()].filter((t) => !t.deleted).map(tbTorrent));
  });
  tb.get('/v1/api/torrents/requestdl', (c) => {
    const torrent = live(c.req.query('torrent_id'));
    const index = Number(c.req.query('file_id'));
    if (!torrent || !torrent.files[index]) return tbError(c, 400, 'ITEM_NOT_FOUND');
    // Like TorBox's CDN: no file name in the URL.
    const uuid = createHash('md5').update(`${torrent.id}-${index}`).digest('hex');
    return tbOk(
      c,
      `${origin(c)}/cdn/torbox/dld/${uuid}?token=secret&size=${torrent.files[index]!.size}`,
    );
  });
  tb.post('/v1/api/torrents/controltorrent', async (c) => {
    const body = (await c.req.json()) as { torrent_id: number; operation: string };
    const torrent = live(String(body.torrent_id));
    if (!torrent) return tbError(c, 500, 'DATABASE_ERROR');
    if (body.operation === 'delete') torrent.deleted = true;
    return tbOk(c, null, 'Torrent operation processed successfully.');
  });
  app.route('/torbox', tb);

  return { app, torrents };
}

export type MockDebrid = ReturnType<typeof createMockDebrid>;
