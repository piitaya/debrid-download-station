import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../src/server/errors.js';
import { SynologyClient, toTask } from '../src/server/nas/synology.js';
import { NasSessionError } from '../src/server/nas/types.js';
import { createMockDsm } from './mocks/synology.js';
import { listen } from './serve.js';

const dsm = createMockDsm({
  users: {
    admin: { password: 'secret pass', isManager: true },
    bob: { password: 'bob', otp: '123456' },
    carl: { password: 'carl', isManager: null },
  },
  folders: ['/video', '/video/Séries', '/music'],
});
let server: Awaited<ReturnType<typeof listen>>;
let client: SynologyClient;

beforeAll(async () => {
  server = await listen(dsm.app);
  client = new SynologyClient({ baseUrl: server.url, insecureTls: false });
});
afterAll(() => server.close());

const errorCode = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof AppError ? error.code : String(error);
  }
  return 'no error';
};

describe('SynologyClient', () => {
  it('logs in (passwords with spaces) and reports manager status', async () => {
    const result = await client.login({ account: 'admin', password: 'secret pass' });
    expect(result.sid).toMatch(/^sid-/);
    expect(result.isManager).toBe(true);
    await client.checkSession(result.sid);
    // DSM does not always say: the role stays unknown.
    expect((await client.login({ account: 'carl', password: 'carl' })).isManager).toBeNull();
  });

  it('maps login errors', async () => {
    expect(await errorCode(client.login({ account: 'admin', password: 'nope' }))).toBe(
      'invalid_credentials',
    );
    expect(await errorCode(client.login({ account: 'bob', password: 'bob' }))).toBe('otp_required');
    expect(
      await errorCode(client.login({ account: 'bob', password: 'bob', otpCode: '000000' })),
    ).toBe('otp_invalid');
  });

  it('remembers 2FA devices', async () => {
    const first = await client.login({ account: 'bob', password: 'bob', otpCode: '123456' });
    expect(first.deviceId).toBeTruthy();
    expect(first.isManager).toBe(false);
    const second = await client.login({
      account: 'bob',
      password: 'bob',
      deviceId: first.deviceId!,
    });
    expect(second.sid).toBeTruthy();
  });

  it('browses and creates folders with accents and spaces', async () => {
    const { sid } = await client.login({ account: 'admin', password: 'secret pass' });
    expect(await client.listShares(sid)).toEqual([
      { name: 'music', path: 'music' },
      { name: 'video', path: 'video' },
    ]);
    await client.createFolders(sid, [
      'video/Séries/Mon Show S01/Subs',
      'video/Séries/Mon Show S01',
    ]);
    expect(await client.listFolders(sid, 'video/Séries')).toEqual([
      { name: 'Mon Show S01', path: 'video/Séries/Mon Show S01' },
    ]);
    expect(await client.listFolders(sid, 'video/Séries/Mon Show S01')).toEqual([
      { name: 'Subs', path: 'video/Séries/Mon Show S01/Subs' },
    ]);
  });

  it('creates, tracks and deletes download tasks', async () => {
    const { sid } = await client.login({ account: 'admin', password: 'secret pass' });
    const urls = ['https://cdn.example/a,b.mkv?size=100', 'https://cdn.example/c.mkv?size=100'];
    const ids = await client.createDownloadTasks(sid, urls, 'video/Séries');
    expect(ids).toHaveLength(2);
    expect(ids.every((id) => id?.startsWith('dbid_'))).toBe(true);

    const tasks = await client.getTasks(sid, ids as string[]);
    expect(tasks.map((task) => task.id).sort()).toEqual([...(ids as string[])].sort());
    expect(tasks[0]!.uri).toContain('a%2Cb.mkv');

    await client.deleteTasks(sid, [ids[0]!]);
    expect((await client.getTasks(sid, ids as string[])).map((task) => task.id)).toEqual([ids[1]]);
  });

  it('reports a missing destination', async () => {
    const { sid } = await client.login({ account: 'admin', password: 'secret pass' });
    expect(
      await errorCode(client.createDownloadTasks(sid, ['https://x/y.mkv'], 'video/Nope')),
    ).toBe('destination_missing');
  });

  it('detects expired sessions', async () => {
    const { sid } = await client.login({ account: 'admin', password: 'secret pass' });
    dsm.expireSessions();
    await expect(client.checkSession(sid)).rejects.toBeInstanceOf(NasSessionError);
    await expect(client.listShares(sid)).rejects.toBeInstanceOf(NasSessionError);
  });
});

describe('toTask', () => {
  it('reads legacy tasks', () => {
    expect(
      toTask({
        id: 'dbid_1',
        status: 'error',
        size: '100',
        status_extra: { error_detail: 'broken_link' },
        additional: { transfer: { size_downloaded: '10', speed_download: 0 } },
      }),
    ).toMatchObject({
      id: 'dbid_1',
      status: 'error',
      error: 'broken_link',
      size: 100,
      downloaded: 10,
    });
  });

  it('reads Download Station 2 numeric statuses', () => {
    expect(toTask({ id: 'a', status: 5 }).status).toBe('finished');
    expect(toTask({ id: 'b', status: 105 })).toMatchObject({ status: 'error', error: 'disk_full' });
  });
});
