import { getConnInfo } from '@hono/node-server/conninfo';
import { createHash } from 'node:crypto';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { streamSSE } from 'hono/streaming';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { extractMagnets } from '../shared/magnet.js';
import { parseTorrent, TorrentParseError } from '../shared/torrent.js';
import {
  isProviderId,
  type AddJobResult,
  type AddJobsResponse,
  type ErrorCode,
  type FolderListing,
  type ProviderId,
  type ProviderTestResult,
  type SessionInfo,
  type SessionStatus,
} from '../shared/types.js';
import type { DebridProvider } from './debrid/types.js';
import type { Env } from './env.js';
import { AppError, HttpError, toErrorInfo } from './errors.js';
import type { EventHub } from './events.js';
import type { JobManager } from './jobs.js';
import { log } from './logger.js';
import type { NasLogins } from './nas-logins.js';
import { NasSessionError, type NasClient } from './nas/types.js';
import { joinPath, sanitizeSegment } from './paths.js';
import type { RateLimiter } from './rate-limit.js';
import type { Sessions, StoredSession } from './sessions.js';
import { normalizeDestination, type Settings } from './settings.js';

export interface AppDeps {
  env: Env;
  settings: Settings;
  sessions: Sessions;
  /** Keeps the users' DSM sessions going. */
  logins: NasLogins;
  jobs: JobManager;
  events: EventHub;
  nas: NasClient | null;
  provider: (id: ProviderId) => DebridProvider;
  providerWithKey: (id: ProviderId, apiKey: string) => DebridProvider;
  /** Failed logins per client IP. */
  loginLimiter: RateLimiter;
  /** Failed logins overall: every login reaches DSM from the same (container) IP. */
  globalLoginLimiter: RateLimiter;
}

type Vars = { session: StoredSession; token: string };
type Ctx = Context<{ Variables: Vars }>;

const SESSION_COOKIE = 'dds_session';
const DEVICE_COOKIE = 'dds_device';
const MAX_TORRENT_SIZE = 10 * 1024 * 1024;
const SESSION_CHECK_INTERVAL = 5 * 60 * 1000;

const STATUS_BY_CODE: Partial<Record<ErrorCode, ContentfulStatusCode>> = {
  unauthorized: 401,
  nas_session_expired: 401,
  invalid_credentials: 401,
  otp_required: 401,
  otp_invalid: 401,
  otp_setup_required: 403,
  not_allowed: 403,
  no_permission: 403,
  account_disabled: 403,
  password_expired: 403,
  ip_blocked: 403,
  forbidden: 403,
  too_many_attempts: 429,
  provider_rate_limited: 429,
  not_found: 404,
  invalid_request: 400,
  magnet_invalid: 400,
  torrent_invalid: 400,
  category_missing: 400,
  provider_not_configured: 400,
  nas_not_configured: 503,
  download_station_unavailable: 503,
  nas_unreachable: 502,
  provider_unreachable: 502,
};

export function createApp(deps: AppDeps): Hono<{ Variables: Vars }> {
  const { env, settings, sessions, logins, jobs, events } = deps;
  const lastSessionCheck = new Map<string, number>();

  const app = new Hono<{ Variables: Vars }>();

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        manifestSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
      },
      // Keep referrers out of the debrid sites opened from the settings.
      referrerPolicy: 'no-referrer',
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    if (error instanceof HttpError) return c.json({ error: error.toInfo() }, error.status);
    if (error instanceof AppError) {
      return c.json({ error: error.toInfo() }, STATUS_BY_CODE[error.code] ?? 502);
    }
    log.error(`Unhandled error on ${c.req.method} ${c.req.path}`, error);
    return c.json({ error: { code: 'internal' } }, 500);
  });

  // ADMIN_USERS when set, DSM administrators otherwise.
  const isAdmin = (session: StoredSession) =>
    env.adminUsers.length ? env.adminUsers.includes(session.username) : session.isManager;

  const isHttps = (c: Ctx) =>
    new URL(c.req.url).protocol === 'https:' ||
    c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() === 'https';

  const clientIp = (c: Ctx): string => {
    if (env.trustProxy) {
      const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
      if (forwarded) return forwarded;
    }
    try {
      return getConnInfo(c).remote.address ?? 'unknown';
    } catch {
      return 'unknown';
    }
  };

  const nas = (): NasClient => {
    if (!deps.nas) throw new HttpError(503, 'nas_not_configured');
    return deps.nas;
  };

  /**
   * Runs a NAS call with the user's DSM session. When DSM dropped it, logs in again with the
   * stored login and makes the call once more.
   */
  const withNas = async <T>(c: Ctx, call: (client: NasClient, sid: string) => Promise<T>) => {
    const session = c.get('session');
    try {
      return await call(nas(), session.dsmSid);
    } catch (error) {
      if (!(error instanceof NasSessionError)) throw error;
      await logins.expired(session.dsmSid);
      if (!session.dsmValid) throw new HttpError(401, 'nas_session_expired');
      return call(nas(), session.dsmSid);
    }
  };

  const sessionInfo = (session: StoredSession): SessionInfo => ({
    user: { username: session.username, isAdmin: isAdmin(session) },
    nasUrl: env.synologyUrl ?? '',
    version: env.version,
  });

  const api = new Hono<{ Variables: Vars }>();

  // Mutating requests must come from the app itself (a cross-site form cannot set this header).
  api.use('*', async (c, next) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) &&
      c.req.header('x-requested-with') !== 'dds'
    ) {
      throw new HttpError(403, 'forbidden', 'Missing X-Requested-With header');
    }
    await next();
  });

  const requireSession: MiddlewareHandler<{ Variables: Vars }> = async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const session = sessions.get(token);
    if (!session || !token) throw new HttpError(401, 'unauthorized');
    if (!(await logins.revive(session))) throw new HttpError(401, 'nas_session_expired');
    c.set('session', session);
    c.set('token', token);
    await next();
  };

  const requireAdmin: MiddlewareHandler<{ Variables: Vars }> = async (c, next) => {
    if (!isAdmin(c.get('session'))) throw new HttpError(403, 'forbidden');
    await next();
  };

  api.get('/health', (c) => c.json({ status: 'ok', version: env.version }));

  api.post('/login', async (c) => {
    const ip = clientIp(c);
    if (deps.loginLimiter.isBlocked(ip) || deps.globalLoginLimiter.isBlocked('*')) {
      throw new HttpError(429, 'too_many_attempts');
    }
    const fail = () => {
      deps.loginLimiter.fail(ip);
      deps.globalLoginLimiter.fail('*');
    };
    const client = nas();

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const otp = typeof body.otp === 'string' ? body.otp.replace(/\s/g, '') : '';
    if (!username || !password) throw new HttpError(400, 'invalid_request');

    let deviceId: string | undefined;
    try {
      const device = JSON.parse(getCookie(c, DEVICE_COOKIE) ?? '{}') as { u?: string; d?: string };
      if (device.u === username && device.d) deviceId = device.d;
    } catch {
      // Ignore a malformed cookie.
    }

    let result;
    try {
      result = await client.login({
        account: username,
        password,
        otpCode: otp || undefined,
        deviceId,
      });
    } catch (error) {
      if (error instanceof AppError && error.code === 'otp_required') {
        // The password is right: the code is the next step, not a failed attempt.
        return c.json({ session: null, reason: 'otp_required' } satisfies SessionStatus);
      }
      if (
        error instanceof AppError &&
        ['invalid_credentials', 'otp_invalid'].includes(error.code)
      ) {
        fail();
      }
      throw error;
    }

    if (env.allowedUsers.length && !env.allowedUsers.includes(username)) {
      await client.logout(result.sid).catch(() => undefined);
      fail();
      throw new HttpError(403, 'not_allowed');
    }
    deps.loginLimiter.reset(ip);

    // The password is kept (encrypted) to log in again when DSM drops the session.
    const credentials = logins.seal({ password, deviceId: result.deviceId ?? deviceId ?? null });
    const { token, session } = sessions.create(username, result.sid, result.isManager, credentials);
    const secure = isHttps(c);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure,
      path: '/',
      maxAge: env.sessionTtlDays * 24 * 3600,
    });
    if (result.deviceId) {
      setCookie(c, DEVICE_COOKIE, JSON.stringify({ u: username, d: result.deviceId }), {
        httpOnly: true,
        sameSite: 'Lax',
        secure,
        path: '/',
        maxAge: 365 * 24 * 3600,
      });
    }
    jobs.resumeFor(username);
    log.info(`User "${username}" logged in`);
    return c.json({ session: sessionInfo(session) } satisfies SessionStatus);
  });

  // Being signed out is an answer, not an error (see SessionStatus).
  api.get('/session', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    const session = sessions.get(token);
    if (!token || !session) {
      if (!token) return c.json({ session: null } satisfies SessionStatus);
      // A cookie left by a session that is over: said once, then forgotten.
      deleteCookie(c, SESSION_COOKIE, { path: '/' });
      return c.json({ session: null, reason: 'unauthorized' } satisfies SessionStatus);
    }
    const nasExpired = { session: null, reason: 'nas_session_expired' } satisfies SessionStatus;
    if (!(await logins.revive(session))) return c.json(nasExpired);
    c.set('session', session);
    c.set('token', token);
    // Makes sure DSM still accepts the session from time to time.
    if (Date.now() - (lastSessionCheck.get(token) ?? 0) > SESSION_CHECK_INTERVAL) {
      try {
        await withNas(c, (client, sid) => client.checkSession(sid));
        lastSessionCheck.set(token, Date.now());
      } catch (error) {
        if (error instanceof AppError && error.code === 'nas_session_expired') {
          return c.json(nasExpired);
        }
        // An unreachable NAS should not log the user out.
        if (!(error instanceof AppError) || error.code !== 'nas_unreachable') throw error;
      }
    }
    return c.json({ session: sessionInfo(session) } satisfies SessionStatus);
  });

  api.post('/logout', requireSession, async (c) => {
    const session = sessions.delete(c.get('token'));
    lastSessionCheck.delete(c.get('token'));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    if (session && deps.nas) await deps.nas.logout(session.dsmSid).catch(() => undefined);
    return c.body(null, 204);
  });

  api.get('/settings', requireSession, (c) => c.json(settings.toPublic()));

  api.put('/settings', requireSession, requireAdmin, async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') throw new HttpError(400, 'invalid_request');
    return c.json(settings.update(body));
  });

  api.post('/providers/:id/test', requireSession, requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!isProviderId(id)) throw new HttpError(404, 'not_found');
    const body = (await c.req.json().catch(() => ({}))) as { apiKey?: unknown };
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    // A refused key (or a service out of reach) is what the test found, not a failed request.
    let result: ProviderTestResult;
    try {
      const provider = apiKey ? deps.providerWithKey(id, apiKey) : deps.provider(id);
      result = { ok: true, account: await provider.account() };
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      result = { ok: false, error: error.toInfo() };
    }
    return c.json(result);
  });

  api.get('/folders', requireSession, requireAdmin, async (c) => {
    const raw = c.req.query('path');
    const path = raw ? normalizeDestination(raw) : null;
    if (raw && !path) throw new HttpError(400, 'invalid_request');
    try {
      const folders = await withNas(c, (client, sid) =>
        path ? client.listFolders(sid, path) : client.listShares(sid),
      );
      return c.json({ path, exists: true, folders } satisfies FolderListing);
    } catch (error) {
      // A folder that does not exist is an answer: the app offers to create it.
      if (!(error instanceof AppError) || error.code !== 'destination_missing') throw error;
      return c.json({ path, exists: false, folders: [] } satisfies FolderListing);
    }
  });

  api.post('/folders', requireSession, requireAdmin, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { path?: unknown; name?: unknown };
    const parent = typeof body.path === 'string' ? normalizeDestination(body.path) : null;
    const name = typeof body.name === 'string' ? sanitizeSegment(body.name) : '';
    if (!parent || !name) throw new HttpError(400, 'invalid_request');
    const path = joinPath(parent, name);
    await withNas(c, (client, sid) => client.createFolders(sid, [path]));
    return c.json({ name, path });
  });

  api.get('/jobs', requireSession, (c) => {
    const owner = c.get('session').username;
    return c.json({ jobs: jobs.list(owner).map((job) => jobs.toView(job)) });
  });

  api.post(
    '/jobs',
    requireSession,
    bodyLimit({
      maxSize: 25 * 1024 * 1024,
      onError: () => {
        throw new HttpError(413, 'torrent_invalid', 'Request too large');
      },
    }),
    async (c) => {
      const owner = c.get('session').username;
      let providerId: unknown;
      let categoryId: unknown;
      let magnetInputs: string[];
      let torrentFiles: File[] = [];

      if (c.req.header('content-type')?.includes('multipart/form-data')) {
        const form = await c.req.parseBody({ all: true });
        const values = (key: string) => {
          const value = form[key];
          return value === undefined ? [] : Array.isArray(value) ? value : [value];
        };
        providerId = form.provider;
        categoryId = form.categoryId;
        magnetInputs = values('magnets').filter((v): v is string => typeof v === 'string');
        torrentFiles = values('torrents').filter((v): v is File => v instanceof File);
      } else {
        const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
        providerId = body.provider;
        categoryId = body.categoryId;
        magnetInputs = Array.isArray(body.magnets)
          ? body.magnets.filter((v): v is string => typeof v === 'string')
          : [];
      }

      if (!isProviderId(providerId)) throw new HttpError(400, 'invalid_request', 'provider');
      const provider = deps.provider(providerId);
      const category = typeof categoryId === 'string' ? settings.category(categoryId) : null;
      if (!category) throw new HttpError(400, 'category_missing');
      if (!magnetInputs.length && !torrentFiles.length) {
        throw new HttpError(400, 'invalid_request', 'Nothing to add');
      }

      const results: AddJobResult[] = [];
      const addJob = (debridId: string, name: string) =>
        jobs.toView(
          jobs.create({
            owner,
            provider: providerId as ProviderId,
            debridId,
            name,
            category,
          }),
        );

      for (const input of magnetInputs) {
        const { magnets, invalid } = extractMagnets(input);
        for (const token of invalid) {
          results.push({ ok: false, input: token, error: { code: 'magnet_invalid' } });
        }
        for (const magnet of magnets) {
          try {
            const added = await provider.addMagnet(magnet.uri, magnet.hash);
            const name = magnet.name ?? added.name ?? magnet.hash ?? 'magnet';
            results.push({ ok: true, job: addJob(added.id, name) });
          } catch (error) {
            results.push({ ok: false, input: magnet.uri, error: toErrorInfo(error) });
          }
        }
      }

      for (const file of torrentFiles) {
        try {
          if (file.size > MAX_TORRENT_SIZE) throw new AppError('torrent_invalid', 'File too large');
          const data = new Uint8Array(await file.arrayBuffer());
          let name: string;
          let hash: string;
          try {
            const meta = parseTorrent(data);
            name = meta.name;
            hash = createHash('sha1')
              .update(data.subarray(...meta.infoRange))
              .digest('hex');
          } catch (error) {
            if (error instanceof TorrentParseError) throw new AppError('torrent_invalid');
            throw error;
          }
          const added = await provider.addTorrent(data, file.name || `${name}.torrent`, hash);
          results.push({ ok: true, job: addJob(added.id, added.name ?? name) });
        } catch (error) {
          results.push({ ok: false, input: file.name, error: toErrorInfo(error) });
        }
      }

      const added = results.filter((result) => result.ok).length;
      if (added) log.info(`${owner} added ${added} torrent(s) to ${providerId}`);
      return c.json({ results } satisfies AddJobsResponse);
    },
  );

  api.post('/jobs/clear', requireSession, (c) => {
    jobs.clearFinished(c.get('session').username);
    return c.body(null, 204);
  });

  api.post('/jobs/:id/retry', requireSession, (c) => {
    const job = jobs.retry(c.get('session').username, c.req.param('id'));
    return c.json(jobs.toView(job));
  });

  api.delete('/jobs/:id', requireSession, async (c) => {
    await jobs.remove(c.get('session').username, c.req.param('id'), c.req.query('cancel') === '1');
    return c.body(null, 204);
  });

  api.get('/events', requireSession, (c) => {
    const owner = c.get('session').username;
    // Tell reverse proxies (nginx on DSM) not to buffer the stream.
    c.header('X-Accel-Buffering', 'no');
    c.header('Cache-Control', 'no-cache');
    return streamSSE(c, async (stream) => {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (!closed) void stream.writeSSE({ event, data: JSON.stringify(data) });
      };
      send('snapshot', { jobs: jobs.list(owner).map((job) => jobs.toView(job)) });
      const unsubscribe = events.subscribe(owner, send);
      const ping = setInterval(() => {
        if (!closed) void stream.write(': ping\n\n');
      }, 20_000);
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          closed = true;
          unsubscribe();
          clearInterval(ping);
          resolve();
        });
      });
    });
  });

  api.all('*', () => {
    throw new HttpError(404, 'not_found');
  });

  app.route('/api', api);

  // Web app: hashed assets are immutable, everything else must be revalidated.
  app.use(
    '/*',
    serveStatic({
      root: env.webRoot,
      onFound: (path, c) => {
        c.header(
          'Cache-Control',
          path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    }),
  );
  app.get(
    '*',
    serveStatic({
      root: env.webRoot,
      path: 'index.html',
      onFound: (_path, c) => {
        c.header('Cache-Control', 'no-cache');
      },
    }),
  );

  return app;
}
