import { serve } from '@hono/node-server';
import { join } from 'node:path';
import type { ProviderId } from '../shared/types.js';
import { createApp } from './app.js';
import { createProvider, Providers } from './debrid/index.js';
import { loadEnv } from './env.js';
import { AppError } from './errors.js';
import { EventHub } from './events.js';
import { JobManager, type JobsFile } from './jobs.js';
import { log, setLogLevel } from './logger.js';
import { SynologyClient } from './nas/synology.js';
import { dropPrivileges } from './privileges.js';
import { NasSessionError, type NasClient } from './nas/types.js';
import { RateLimiter } from './rate-limit.js';
import { Sessions, type SessionMap } from './sessions.js';
import { defaultSettings, Settings, type StoredSettings } from './settings.js';
import { ensureDir, JsonFile } from './storage.js';

const KEEP_ALIVE_MS = 10 * 60 * 1000;

const env = loadEnv();
setLogLevel(env.logLevel);
ensureDir(env.dataDir);
dropPrivileges(env.dataDir);

const settingsFile = new JsonFile<StoredSettings>(
  join(env.dataDir, 'settings.json'),
  defaultSettings,
);
const sessionsFile = new JsonFile<SessionMap>(join(env.dataDir, 'sessions.json'), () => ({}));
const jobsFile = new JsonFile<JobsFile>(join(env.dataDir, 'jobs.json'), () => ({ jobs: [] }));

const settings = new Settings(settingsFile, env);
const sessions = new Sessions(sessionsFile, env.sessionTtlDays * 24 * 3600 * 1000);
const events = new EventHub();
const providers = new Providers(settings, env);

const nas: NasClient | null = env.synologyUrl
  ? new SynologyClient({ baseUrl: env.synologyUrl, insecureTls: env.synologyInsecureTls })
  : null;

const unavailable = (): never => {
  throw new AppError('nas_not_configured');
};
const noNas: NasClient = {
  login: unavailable,
  logout: unavailable,
  checkSession: unavailable,
  createFolders: unavailable,
  listShares: unavailable,
  listFolders: unavailable,
  rename: unavailable,
  createDownloadTasks: unavailable,
  getTasks: unavailable,
  listTasks: unavailable,
  deleteTasks: unavailable,
};

const jobs = new JobManager({
  file: jobsFile,
  nas: nas ?? noNas,
  sessions,
  events,
  provider: (id: ProviderId) => providers.get(id),
  options: () => ({
    createSubfolder: settings.createSubfolder,
    deleteFromDebrid: settings.deleteFromDebrid,
  }),
});

const app = createApp({
  env,
  settings,
  sessions,
  jobs,
  events,
  nas,
  provider: (id) => providers.get(id),
  providerWithKey: (id, apiKey) => createProvider(id, apiKey, env),
  // DSM blocks an IP after 10 failed logins within 5 minutes (by default, forever), and all
  // logins reach DSM from this container: stay well below that.
  loginLimiter: new RateLimiter(5, 15 * 60 * 1000),
  globalLoginLimiter: new RateLimiter(6, 5 * 60 * 1000),
});

log.info(`Syno Debrid ${env.version}`);
if (nas) log.info(`NAS: ${env.synologyUrl}${env.synologyInsecureTls ? ' (TLS not verified)' : ''}`);
else log.warn('SYNOLOGY_URL is not set: nobody will be able to log in.');
const configured = settings.configuredProviders();
log.info(
  `Debrid services: ${configured.length ? configured.join(', ') : 'none yet (see Settings)'}`,
);

const server = serve({ fetch: app.fetch, port: env.port, hostname: env.host }, (info) => {
  log.info(`Listening on http://${info.address}:${info.port}`);
});
jobs.start();

// Keeps DSM sessions alive (and notices those DSM dropped, e.g. after a reboot).
const keepAlive = setInterval(async () => {
  sessions.purgeExpired();
  if (!nas) return;
  for (const sid of sessions.activeDsmSids()) {
    try {
      await nas.checkSession(sid);
    } catch (error) {
      if (error instanceof NasSessionError) sessions.markDsmInvalid(sid);
    }
  }
}, KEEP_ALIVE_MS);
keepAlive.unref();

let stopping = false;
function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  log.info(`${signal} received, shutting down`);
  jobs.stop();
  clearInterval(keepAlive);
  for (const file of [settingsFile, sessionsFile, jobsFile]) {
    try {
      file.flushSync();
    } catch (error) {
      log.error('Failed to save data', error);
    }
  }
  server.close();
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
