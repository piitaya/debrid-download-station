import { Hono } from 'hono';

/*
 * A fake Synology DSM (DSM 7 + Download Station 4 + File Station), enough to run the app
 * end-to-end in tests, local development and screenshots.
 */

export interface MockUser {
  password: string;
  /** When set, logging in requires this 2FA code. */
  otp?: string;
  /** Download Station manager (DSM administrator); null: DSM does not say. */
  isManager?: boolean | null;
}

export interface MockTask {
  id: string;
  username: string;
  uri: string;
  destination: string;
  size: number;
  createdAt: number;
  /** Bytes per second. */
  speed: number;
  deleted: boolean;
  fail?: string;
}

export interface MockDsmOptions {
  users?: Record<string, MockUser>;
  folders?: string[];
  /** Download speed of simulated tasks, bytes per second. */
  speed?: number;
  now?: () => number;
}

const API_INFO = {
  'SYNO.API.Auth': { maxVersion: 7, minVersion: 1, path: 'entry.cgi' },
  'SYNO.DownloadStation.Info': { maxVersion: 2, minVersion: 1, path: 'DownloadStation/info.cgi' },
  'SYNO.DownloadStation.Task': { maxVersion: 3, minVersion: 1, path: 'DownloadStation/task.cgi' },
  'SYNO.DownloadStation2.Task': {
    maxVersion: 2,
    minVersion: 1,
    path: 'entry.cgi',
    requestFormat: 'JSON',
  },
  'SYNO.DownloadStation2.Settings.Location': {
    maxVersion: 1,
    minVersion: 1,
    path: 'entry.cgi',
    requestFormat: 'JSON',
  },
  'SYNO.FileStation.List': {
    maxVersion: 2,
    minVersion: 1,
    path: 'entry.cgi',
    requestFormat: 'JSON',
  },
  'SYNO.FileStation.CreateFolder': {
    maxVersion: 2,
    minVersion: 1,
    path: 'entry.cgi',
    requestFormat: 'JSON',
  },
  'SYNO.FileStation.Rename': {
    maxVersion: 2,
    minVersion: 1,
    path: 'entry.cgi',
    requestFormat: 'JSON',
  },
};

/** Parses a JSON-encoded parameter, falling back to the raw string (like DSM seems to do). */
function jsonParam<T>(value: string | undefined): T | string | undefined {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return value;
  }
}

export function createMockDsm(options: MockDsmOptions = {}) {
  const now = options.now ?? Date.now;
  const users: Record<string, MockUser> = options.users ?? {
    admin: { password: 'admin', isManager: true },
  };
  const folders = new Set(
    (options.folders ?? ['/video', '/video/Films', '/video/Séries', '/music', '/downloads']).map(
      (path) => path.toLowerCase(),
    ),
  );
  const folderNames = new Map<string, string>();
  for (const path of options.folders ?? [
    '/video',
    '/video/Films',
    '/video/Séries',
    '/music',
    '/downloads',
  ]) {
    folderNames.set(path.toLowerCase(), path);
  }
  const sessions = new Map<string, string>();
  const tasks = new Map<string, MockTask>();
  const devices = new Map<string, string>();
  let nextTask = 1;
  let nextSid = 1;
  let nextDevice = 1;
  const state = {
    speed: options.speed ?? 40 * 1024 * 1024,
    calls: [] as string[],
    renamed: [] as string[],
  };

  const addFolder = (path: string) => {
    const parts = path.split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) {
      const sub = `/${parts.slice(0, i).join('/')}`;
      folders.add(sub.toLowerCase());
      if (!folderNames.has(sub.toLowerCase())) folderNames.set(sub.toLowerCase(), sub);
    }
  };

  const taskView = (task: MockTask, ds2: boolean) => {
    const elapsed = Math.max(0, (now() - task.createdAt) / 1000 - 0.5);
    const downloaded = Math.min(task.size, Math.floor(elapsed * task.speed));
    const done = downloaded >= task.size;
    let status: string | number = task.fail
      ? 'error'
      : done
        ? 'finished'
        : elapsed > 0
          ? 'downloading'
          : 'waiting';
    if (ds2) status = { waiting: 1, downloading: 2, finished: 5, error: 102 }[status] ?? 2;
    return {
      id: task.id,
      type: 'https',
      username: task.username,
      title: decodeURIComponent(task.uri.split('/').pop()?.split('?')[0] ?? 'file'),
      size: String(task.size),
      status,
      status_extra: task.fail ? { error_detail: task.fail } : null,
      additional: {
        detail: {
          destination: task.destination,
          uri: task.uri,
          create_time: Math.floor(task.createdAt / 1000),
        },
        transfer: {
          size_downloaded: String(downloaded),
          speed_download: done || task.fail ? 0 : task.speed,
        },
      },
    };
  };

  const app = new Hono();
  const fail = (code: number, extra: Record<string, unknown> = {}) => ({
    success: false,
    error: { code, ...extra },
  });

  app.post('/webapi/query.cgi', (c) => c.json({ success: true, data: API_INFO }));

  app.post('/webapi/*', async (c) => {
    const params = (await c.req.parseBody()) as Record<string, string>;
    const { api, method } = params;
    state.calls.push(`${api}.${method}`);
    const sid = params._sid;
    const username = sid ? sessions.get(sid) : undefined;
    const legacy = c.req.path.includes('/DownloadStation/');

    if (api === 'SYNO.API.Auth') {
      if (method === 'logout') {
        if (sid) sessions.delete(sid);
        return c.json({ success: true });
      }
      const account = (params.account ?? '').toLowerCase();
      const user = users[account];
      if (!user || user.password !== params.passwd) return c.json(fail(400));
      let did: string | undefined;
      if (user.otp) {
        const trusted = params.device_id && devices.get(params.device_id) === account;
        if (!trusted) {
          if (!params.otp_code) return c.json(fail(403));
          if (params.otp_code !== user.otp) return c.json(fail(404));
          if (params.enable_device_token === 'yes') {
            did = `device-${nextDevice++}`;
            devices.set(did, account);
          }
        }
      }
      const newSid = `sid-${nextSid++}-${Math.random().toString(36).slice(2)}`;
      sessions.set(newSid, account);
      return c.json({
        success: true,
        data: { sid: newSid, did: did ?? '', is_portal_port: false },
      });
    }

    if (!username) return c.json(fail(legacy ? 105 : 119));
    const user = users[username]!;

    if (api === 'SYNO.DownloadStation.Info') {
      const role = user.isManager === null ? {} : { is_manager: user.isManager ?? false };
      return c.json({
        success: true,
        data: { ...role, version: 4000, version_string: '4.0.0' },
      });
    }

    if (api === 'SYNO.DownloadStation2.Settings.Location') {
      return c.json({ success: true, data: { default_destination: 'downloads' } });
    }

    if (api === 'SYNO.DownloadStation2.Task' && method === 'create') {
      const destination = jsonParam<string>(params.destination);
      const urls = jsonParam<string[]>(params.url);
      if (
        jsonParam(params.type) !== 'url' ||
        typeof destination !== 'string' ||
        !Array.isArray(urls)
      ) {
        return c.json(fail(120));
      }
      if (!folders.has(`/${destination}`.toLowerCase())) return c.json(fail(403));
      const ids = urls.map((uri) => {
        const id = `dbid_${nextTask++}`;
        const size = Number(
          new URL(uri.replace(/%2C/g, ',')).searchParams.get('size') ?? 700 * 1024 * 1024,
        );
        tasks.set(id, {
          id,
          username,
          uri,
          destination,
          size,
          createdAt: now(),
          speed: state.speed,
          deleted: false,
        });
        return id;
      });
      return c.json({ success: true, data: { list_id: [], task_id: ids } });
    }

    if (api === 'SYNO.DownloadStation.Task' && (method === 'list' || method === 'getinfo')) {
      const wanted = method === 'getinfo' ? new Set((params.id ?? '').split(',')) : null;
      const list = [...tasks.values()]
        .filter((task) => task.username === username && !task.deleted)
        .filter((task) => !wanted || wanted.has(task.id))
        .map((task) => taskView(task, false));
      return c.json({ success: true, data: { tasks: list, offset: 0, total: list.length } });
    }

    if (api === 'SYNO.DownloadStation2.Task' && method === 'list') {
      const list = [...tasks.values()]
        .filter((task) => task.username === username && !task.deleted)
        .map((task) => taskView(task, true));
      return c.json({ success: true, data: { task: list, offset: 0, total: list.length } });
    }

    if (api === 'SYNO.DownloadStation.Task' && method === 'delete') {
      const ids = (params.id ?? '').split(',');
      for (const id of ids) {
        const task = tasks.get(id);
        if (task && task.username === username) task.deleted = true;
      }
      return c.json({ success: true, data: ids.map((id) => ({ error: 0, id })) });
    }

    if (api === 'SYNO.FileStation.List' && method === 'list_share') {
      const shares = [...folders]
        .filter((path) => path.split('/').length === 2)
        .map((path) => folderNames.get(path) ?? path)
        .sort()
        .map((path) => ({ isdir: true, name: path.slice(1), path }));
      return c.json({ success: true, data: { shares, offset: 0, total: shares.length } });
    }

    if (api === 'SYNO.FileStation.List' && method === 'list') {
      const parent = String(jsonParam<string>(params.folder_path) ?? '').toLowerCase();
      if (!folders.has(parent)) return c.json(fail(408));
      const depth = parent.split('/').length + 1;
      const files = [...folders]
        .filter((path) => path.startsWith(`${parent}/`) && path.split('/').length === depth)
        .map((path) => folderNames.get(path) ?? path)
        .sort()
        .map((path) => ({ isdir: true, name: path.split('/').pop(), path }));
      return c.json({ success: true, data: { files, offset: 0, total: files.length } });
    }

    if (api === 'SYNO.FileStation.Rename') {
      const paths = jsonParam<string[]>(params.path);
      const names = jsonParam<string[]>(params.name);
      if (!Array.isArray(paths) || !Array.isArray(names)) return c.json(fail(401));
      state.renamed.push(...paths.map((path, index) => `${path} -> ${names[index]}`));
      return c.json({ success: true, data: { files: [] } });
    }

    if (api === 'SYNO.FileStation.CreateFolder') {
      const parents = jsonParam<string[]>(params.folder_path);
      const names = jsonParam<string[]>(params.name);
      if (!Array.isArray(parents) || !Array.isArray(names) || parents.length !== names.length) {
        return c.json(fail(401));
      }
      const created = parents.map((parent, index) => {
        const path = `${parent}/${names[index]}`;
        const share = `/${path.split('/').filter(Boolean)[0]}`.toLowerCase();
        if (!folders.has(share)) return null;
        addFolder(path);
        return { isdir: true, name: names[index], path };
      });
      if (created.includes(null)) return c.json(fail(1100, { errors: [{ code: 408 }] }));
      return c.json({ success: true, data: { folders: created } });
    }

    return c.json(fail(103));
  });

  return {
    app,
    state,
    tasks,
    folders,
    sessions,
    /** Expires every session, like a DSM reboot. */
    expireSessions: () => sessions.clear(),
  };
}

export type MockDsm = ReturnType<typeof createMockDsm>;
