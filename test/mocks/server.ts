import { Hono } from 'hono';
import { createMockDebrid } from './debrid.js';
import { createMockDsm } from './synology.js';

/** Fake NAS + fake debrid services on a single app (see scripts/mock-server.ts). */
export function createMockServer(options: { speed?: number } = {}) {
  const dsm = createMockDsm({
    users: {
      admin: { password: 'admin', isManager: true },
      paul: { password: 'paul', isManager: true },
      marie: { password: 'marie' },
      secure: { password: 'secure', otp: '123456', isManager: true },
      // The dedicated account the README recommends.
      'syno-debrid': { password: 'syno-debrid' },
    },
    folders: [
      '/video',
      '/video/Films',
      '/video/Séries',
      '/video/Enfants',
      '/music',
      '/downloads',
      '/photo',
    ],
    speed: options.speed,
  });
  const debrid = createMockDebrid();
  const app = new Hono();
  app.route('/', debrid.app);
  app.route('/', dsm.app);
  return { app, dsm, debrid };
}
