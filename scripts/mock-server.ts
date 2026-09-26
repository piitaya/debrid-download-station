// Fake Synology NAS + fake AllDebrid / Real-Debrid / TorBox, for local development.
// Accounts: admin/admin, paul/paul (admins), marie/marie, secure/secure (2FA code 123456).
import { serve } from '@hono/node-server';
import { createMockServer } from '../test/mocks/server.js';

const port = Number(process.env.MOCK_PORT ?? 5055);
const { app } = createMockServer({ speed: 8 * 1024 * 1024 });
serve({ fetch: app.fetch, port }, () => {
  console.log(`Mock NAS + debrid services on http://localhost:${port}`);
  console.log('In .env, use the "Without a NAS" lines of .env.example, then run `npm run dev`.');
});
