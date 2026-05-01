// Manual-test helper: launch a Codex session for an existing task on the
// local Convex backend. Bypasses the missing UI provider toggle.
//
// Usage:
//   bun scripts/dev-create-codex-session.ts <taskId> [default|safe-auto|bypass] [prompt...]
//
// Notes:
// - Requires `bun run dev:local` already running (.dev-ports → CONVEX_URL).
// - Signs in as dev@holophyte.test / password (run `bun run seed:dev-user`
//   first if the user doesn't exist yet).
// - The task is created via the UI, then this script attaches a Codex
//   session to it.

import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';

const [taskIdArg, modeArg, ...promptParts] = process.argv.slice(2);
const taskId = taskIdArg as Id<'tasks'> | undefined;
const mode = (modeArg ?? 'default') as 'default' | 'safe-auto' | 'bypass';
const promptOverride = promptParts.length > 0 ? promptParts.join(' ') : undefined;

if (!taskId) {
  console.error(
    'Usage: bun scripts/dev-create-codex-session.ts <taskId> [default|safe-auto|bypass] [prompt...]',
  );
  process.exit(1);
}

const portsFile = await Bun.file('.dev-ports').text().catch(() => '');
const portMatch = portsFile.match(/CONVEX_CLOUD_PORT=(\d+)/);
const port = portMatch?.[1] ?? '3212';
const convexUrl = process.env.CONVEX_URL ?? `http://127.0.0.1:${port}`;

const client = new ConvexHttpClient(convexUrl);

// biome-ignore lint/suspicious/noExplicitAny: convex auth functions aren't in generated api types
const auth = (await client.action('auth:signIn' as any, {
  provider: 'password',
  params: {
    flow: 'signIn',
    email: 'dev@holophyte.test',
    password: 'password',
  },
})) as { tokens?: { token: string; refreshToken: string } };

const token = auth?.tokens?.token;
if (!token) {
  throw new Error('No token returned from signIn — did you run `bun run seed:dev-user`?');
}
client.setAuth(token);

const sessionId = await client.mutation(api.sessions.create, {
  taskId,
  provider: 'codex',
  permissionMode: mode,
  ...(promptOverride !== undefined && { prompt: promptOverride }),
});

console.log(`Codex session queued: ${sessionId}`);
console.log(`  permissionMode: ${mode}`);
console.log(`  Convex URL: ${convexUrl}`);
console.log('');
console.log('Watch the [server] log for [codex session ...] warns to follow the bridge.');
