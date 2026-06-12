/**
 * Tests for request() against a real unix socket — the daemon-crash case
 * (peer FIN with no reply) must reject promptly, not hang until the timer.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from './client';
import { writeJsonLine } from './ndjson';
import { socketPath } from './paths';

let holoHomeDir: string;
let server: net.Server | undefined;

beforeEach(() => {
  holoHomeDir = mkdtempSync(join(tmpdir(), 'holo-'));
  process.env.HOLO_HOME = holoHomeDir;
});

afterEach(async () => {
  if (server) {
    const open = server;
    server = undefined;
    await new Promise((resolve) => open.close(resolve));
  }
  rmSync(holoHomeDir, { recursive: true, force: true });
  delete process.env.HOLO_HOME;
});

function listen(onConnection: (conn: net.Socket) => void): Promise<void> {
  server = net.createServer(onConnection);
  const listening = server;
  return new Promise((resolve) => listening.listen(socketPath(), resolve));
}

describe('request', () => {
  it('resolves with the response line', async () => {
    await listen((conn) => {
      conn.on('data', () => writeJsonLine(conn, { ok: true }));
    });
    expect(await request({ cmd: 'ping' })).toEqual({ ok: true });
  });

  it('rejects promptly when the peer closes without replying', async () => {
    await listen((conn) => {
      conn.on('data', () => conn.end()); // clean FIN, no response, no 'error'
    });
    const started = Date.now();
    await expect(request({ cmd: 'ping' }, { timeoutMs: 5000 })).rejects.toThrow(
      'connection closed before response',
    );
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('rejects with the connect error when no daemon is listening', async () => {
    await expect(request({ cmd: 'ping' })).rejects.toThrow(
      /ENOENT|ECONNREFUSED/,
    );
  });
});
