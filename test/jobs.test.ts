import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EventHub } from '../src/server/events.js';
import { JobManager, type JobsFile } from '../src/server/jobs.js';
import { NasLogins } from '../src/server/nas-logins.js';
import { SynologyClient } from '../src/server/nas/synology.js';
import { Sessions, type SessionMap } from '../src/server/sessions.js';
import { JsonFile } from '../src/server/storage.js';
import { FakeProvider } from './mocks/fake-provider.js';
import { createMockDsm } from './mocks/synology.js';
import { listen } from './serve.js';

let clock = 1_000_000;
const dsm = createMockDsm({
  users: { paul: { password: 'pw', isManager: true } },
  speed: 1000,
  now: () => clock,
});
let server: Awaited<ReturnType<typeof listen>>;
let nas: SynologyClient;

beforeAll(async () => {
  server = await listen(dsm.app);
  nas = new SynologyClient({ baseUrl: server.url, insecureTls: false });
});
afterAll(() => server.close());

function setup(options = { createSubfolder: true, deleteFromDebrid: false }) {
  const dir = mkdtempSync(join(tmpdir(), 'dds-'));
  const sessions = new Sessions(
    new JsonFile<SessionMap>(join(dir, 'sessions.json'), () => ({})),
    86_400_000,
  );
  const provider = new FakeProvider();
  const events = new EventHub();
  const logins = new NasLogins(sessions, () => nas, randomBytes(32));
  const jobs = new JobManager({
    file: new JsonFile<JobsFile>(join(dir, 'jobs.json'), () => ({ jobs: [] })),
    nas,
    logins,
    events,
    provider: () => provider,
    options: () => options,
  });
  return { jobs, sessions, provider, events, logins };
}

const category = { name: 'Séries', icon: 'tv' as const, destination: 'video/Séries' };

async function run(jobs: JobManager, times = 1) {
  for (let i = 0; i < times; i++) {
    for (const job of jobs.list('paul')) job.nextCheckAt = 0;
    await jobs.tick();
  }
}

describe('JobManager', () => {
  beforeEach(() => {
    clock += 100_000;
  });

  it('takes a torrent from the debrid service to Download Station', async () => {
    const { jobs, sessions, provider } = setup();
    const { sid } = await nas.login({ account: 'paul', password: 'pw' });
    sessions.create('paul', sid, true);
    provider.nextPolls = 1;
    const seen: string[] = [];
    const job = jobs.create({
      owner: 'paul',
      provider: 'alldebrid',
      debridId: (await provider.addMagnet()).id,
      name: 'x',
      category,
    });

    await run(jobs);
    seen.push(job.status);
    expect(job.status).toBe('debrid');
    expect(job.progress).toBe(0.5);
    expect(job.seeders).toBe(12);

    await run(jobs);
    seen.push(job.status);
    expect(job.status).toBe('downloading');
    expect(job.folder).toBe('Show.S01');
    expect(job.files.map((file) => file.taskId)).toEqual([
      expect.stringMatching(/^dbid_/),
      expect.stringMatching(/^dbid_/),
    ]);
    expect(dsm.folders.has('/video/séries/show.s01')).toBe(true);
    const created = [...dsm.tasks.values()].filter((task) =>
      job.files.some((f) => f.taskId === task.id),
    );
    expect(created.every((task) => task.destination === 'video/Séries/Show.S01')).toBe(true);

    clock += 1500; // ~half of the second file
    await run(jobs);
    expect(job.status).toBe('downloading');
    expect(job.files[0]!.status).toBe('completed');
    expect(job.progress).toBeGreaterThan(0.3);
    expect(job.progress).toBeLessThan(1);

    clock += 5000;
    await run(jobs);
    expect(job.status).toBe('completed');
    expect(job.progress).toBe(1);
    expect(jobs.toView(job).destination).toBe('video/Séries/Show.S01');
    expect(seen).toEqual(['debrid', 'downloading']);
  });

  it('fails when the debrid service reports a dead torrent', async () => {
    const { jobs, provider } = setup();
    provider.nextDead = true;
    const job = jobs.create({
      owner: 'paul',
      provider: 'alldebrid',
      debridId: (await provider.addMagnet()).id,
      name: 'x',
      category,
    });
    await run(jobs);
    expect(job.status).toBe('error');
    expect(job.error?.code).toBe('torrent_dead');
  });

  it('waits for a NAS session, then resumes', async () => {
    const { jobs, sessions, provider } = setup();
    provider.nextContent = {
      name: 'Movie.mkv',
      multiFile: false,
      files: [{ path: 'Movie.mkv', size: 10, ref: 'm' }],
    };
    const job = jobs.create({
      owner: 'paul',
      provider: 'alldebrid',
      debridId: (await provider.addMagnet()).id,
      name: 'x',
      category,
    });
    await run(jobs);
    expect(job.status).toBe('waiting_login');

    const { sid } = await nas.login({ account: 'paul', password: 'pw' });
    sessions.create('paul', sid, true);
    jobs.resumeFor('paul');
    await jobs.tick();
    expect(job.status).toBe('downloading');
    expect(job.folder).toBeNull();
    expect(dsm.tasks.get(job.files[0]!.taskId!)?.destination).toBe('video/Séries');
  });

  it('flags the session when DSM drops it', async () => {
    const { jobs, sessions, provider } = setup();
    const { sid } = await nas.login({ account: 'paul', password: 'pw' });
    sessions.create('paul', sid, true);
    const job = jobs.create({
      owner: 'paul',
      provider: 'alldebrid',
      debridId: (await provider.addMagnet()).id,
      name: 'x',
      category,
    });
    dsm.expireSessions();
    await run(jobs);
    expect(job.status).toBe('waiting_login');
    expect(sessions.dsmSidFor('paul')).toBeNull();
  });

  it('logs in to DSM again with the stored password to carry on', async () => {
    const { jobs, sessions, provider, logins } = setup();
    const { sid } = await nas.login({ account: 'paul', password: 'pw' });
    sessions.create('paul', sid, true, logins.seal({ password: 'pw', deviceId: null }));
    const job = jobs.create({
      owner: 'paul',
      provider: 'alldebrid',
      debridId: (await provider.addMagnet()).id,
      name: 'x',
      category,
    });
    // DSM drops its sessions (after 7 days, or a reboot): the download goes on by itself.
    dsm.expireSessions();
    await run(jobs, 2);
    expect(job.status).toBe('downloading');
    const renewed = sessions.dsmSidFor('paul');
    expect(renewed).toBeTruthy();
    expect(renewed).not.toBe(sid);
  });

  it('retries failed downloads with fresh links', async () => {
    const { jobs, sessions, provider } = setup({ createSubfolder: true, deleteFromDebrid: true });
    const { sid } = await nas.login({ account: 'paul', password: 'pw' });
    sessions.create('paul', sid, true);
    const job = jobs.create({
      owner: 'paul',
      provider: 'alldebrid',
      debridId: (await provider.addMagnet()).id,
      name: 'x',
      category,
    });
    await run(jobs);
    const [first, second] = job.files;
    dsm.tasks.get(first!.taskId!)!.fail = 'broken_link';
    clock += 10_000;
    await run(jobs);
    expect(job.status).toBe('error');
    expect(job.error).toEqual({ code: 'download_failed', message: 'broken_link' });

    const oldTask = first!.taskId;
    jobs.retry('paul', job.id);
    expect(job.status).toBe('sending');
    await run(jobs);
    expect(job.status).toBe('downloading');
    expect(first!.taskId).not.toBe(oldTask);
    expect(second!.status).toBe('completed');

    clock += 10_000;
    await run(jobs);
    expect(job.status).toBe('completed');
    // deleteFromDebrid: cleaned up once downloaded.
    expect(provider.torrents.get(job.debridId)?.deleted).toBe(true);
  });

  it('cancels a job on Download Station and the debrid service', async () => {
    const { jobs, sessions, provider } = setup();
    const { sid } = await nas.login({ account: 'paul', password: 'pw' });
    sessions.create('paul', sid, true);
    const job = jobs.create({
      owner: 'paul',
      provider: 'alldebrid',
      debridId: (await provider.addMagnet()).id,
      name: 'x',
      category,
    });
    await run(jobs);
    const taskIds = job.files.map((file) => file.taskId!);
    await jobs.remove('paul', job.id, true);
    expect(jobs.list('paul')).not.toContain(job);
    expect(taskIds.every((id) => dsm.tasks.get(id)?.deleted)).toBe(true);
    expect(provider.torrents.get(job.debridId)?.deleted).toBe(true);
  });

  it('renames a downloaded file only from a plain file name', async () => {
    const { jobs, sessions, provider } = setup();
    const { sid } = await nas.login({ account: 'paul', password: 'pw' });
    sessions.create('paul', sid, true);
    // Links that do not end with the file name: Download Station names the files after them.
    const titles: Record<string, string> = { l1: 'dl?id=1', l2: '../../photo/secret.jpg' };
    provider.unlock = async (_id, file) =>
      `https://cdn.example/${encodeURIComponent(titles[file.ref]!)}?size=${file.size}`;
    const renamed = dsm.state.renamed.length;
    const job = jobs.create({
      owner: 'paul',
      provider: 'alldebrid',
      debridId: (await provider.addMagnet()).id,
      name: 'x',
      category,
    });

    await run(jobs, 2);
    clock += 10_000;
    await run(jobs);
    expect(job.status).toBe('completed');
    // The second name holds a path: that file is left as it is.
    expect(dsm.state.renamed.slice(renamed)).toEqual([
      '/video/Séries/Show.S01/dl?id=1 -> Show.S01E01.mkv',
    ]);
  });

  it('clears finished jobs but keeps failed ones', async () => {
    const { jobs, provider } = setup();
    provider.nextDead = true;
    const failed = jobs.create({
      owner: 'paul',
      provider: 'alldebrid',
      debridId: (await provider.addMagnet()).id,
      name: 'x',
      category,
    });
    await run(jobs);
    expect(failed.status).toBe('error');
    const done = jobs.create({
      owner: 'paul',
      provider: 'alldebrid',
      debridId: 'y',
      name: 'y',
      category,
    });
    done.status = 'completed';
    jobs.clearFinished('paul');
    expect(jobs.list('paul')).toEqual([failed]);
  });

  it('keeps each user to their own jobs', async () => {
    const { jobs, provider } = setup();
    const job = jobs.create({
      owner: 'paul',
      provider: 'alldebrid',
      debridId: (await provider.addMagnet()).id,
      name: 'x',
      category,
    });
    expect(() => jobs.get('marie', job.id)).toThrow();
    expect(jobs.list('marie')).toEqual([]);
  });
});
