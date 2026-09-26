import { serve } from '@hono/node-server';
import { join } from 'node:path';
import type { ProviderId } from '../shared/types.js';
import { Account, type StoredAccount } from './account.js';
import { createApp } from './app.js';
import { createProvider, Providers } from './debrid/index.js';
import { loadEnv, OBSOLETE_VARIABLES } from './env.js';
import { EventHub } from './events.js';
import { JobManager, type JobsFile } from './jobs.js';
import { log, setLogLevel } from './logger.js';
import { NasConnection } from './nas-connection.js';
import { SynologyClient } from './nas/synology.js';
import { dropPrivileges } from './privileges.js';
import { RateLimiter } from './rate-limit.js';
import { Sessions, type SessionMap } from './sessions.js';
import { defaultSettings, Settings, type StoredSettings } from './settings.js';
import { ensureDir, JsonFile, loadSecretKey } from './storage.js';

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
const account = new Account(
  new JsonFile<StoredAccount | null>(join(env.dataDir, 'account.json'), () => null),
);
const sessions = new Sessions(sessionsFile, env.sessionTtlDays * 24 * 3600 * 1000);
const events = new EventHub();
const providers = new Providers(settings, env);
const nas = new NasConnection(
  settings,
  loadSecretKey(env.dataDir),
  (url, insecureTls) => new SynologyClient({ baseUrl: url, insecureTls }),
);

const jobs = new JobManager({
  file: jobsFile,
  nas,
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
  account,
  sessions,
  nas,
  jobs,
  events,
  provider: (id) => providers.get(id),
  providerWithKey: (id, apiKey) => createProvider(id, apiKey, env),
  loginLimiter: new RateLimiter(5, 15 * 60 * 1000),
  // DSM blocks an IP after 10 failed logins within 5 minutes (by default, forever), and all
  // logins reach DSM from this container: stay well below that.
  nasLoginLimiter: new RateLimiter(6, 5 * 60 * 1000),
});

log.info(`Syno Debrid ${env.version}`);
for (const name of OBSOLETE_VARIABLES) {
  if (process.env[name]) log.warn(`${name} is no longer used: set up the NAS from the app.`);
}
if (!account.exists) log.info('No account yet: open the app to set it up.');
const nasSettings = settings.nas;
if (nasSettings) log.info(`Download Station: ${nasSettings.url}, account "${nasSettings.account}"`);
const configured = settings.configuredProviders();
log.info(
  `Debrid services: ${configured.length ? configured.join(', ') : 'none yet (see Settings)'}`,
);

const server = serve({ fetch: app.fetch, port: env.port, hostname: env.host }, (info) => {
  log.info(`Listening on http://${info.address}:${info.port}`);
});
jobs.start();
void nas.keepAlive();

// Keeps the DSM session alive, and logs in again when DSM dropped it (after 7 days, a reboot).
const keepAlive = setInterval(() => {
  sessions.purgeExpired();
  void nas.keepAlive();
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
