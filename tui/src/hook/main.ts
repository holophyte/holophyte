/**
 * Hook entry point — injected into agent harnesses as:
 *   <bun> /abs/path/to/src/hook/main.ts <harness> <holoSessionId>
 *
 * Thin I/O shell: stdin JSON → mapHook() → daemon socket. All mapping logic
 * lives in map.ts; transcript reading in transcript.ts.
 *
 * HARD REQUIREMENT (spec.md): never block the agent. Every failure path
 * exits 0 silently and fast. For PermissionRequest, exiting 0 with NO stdout
 * output makes the harness fall through to its normal in-pane permission
 * dialog — the verified degradation path.
 */

import { request } from '../client';
import { mapHook } from './map';
import { lastAssistantMessage } from './transcript';

const STDIN_SAFETY_TIMEOUT_MS = 2000;
const HOOK_REQUEST_TIMEOUT_MS = 1000;
/** how long the daemon holds a permission request open for a remote decision */
const PERMISSION_HOLD_MS = 90000;
/** client-side cap — slightly above the daemon hold so the daemon answers first */
const PERMISSION_SOCKET_TIMEOUT_MS = 95000;

/** Read all of stdin; on the safety timer, proceed with whatever arrived. */
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const finish = () => resolve(Buffer.concat(chunks).toString('utf8'));
    const timer = setTimeout(finish, STDIN_SAFETY_TIMEOUT_MS);
    timer.unref();
    process.stdin.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.from(chunk));
    });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      finish();
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      finish();
    });
  });
}

async function main(): Promise<void> {
  const harness = process.argv[2];
  const sessionId = process.argv[3];
  if ((harness !== 'claude' && harness !== 'codex') || !sessionId) {
    process.exit(0);
  }

  const raw = await readStdin();
  let payload: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    }
  } catch {
    // malformed stdin → nothing to report
  }
  if (payload === undefined) process.exit(0);

  const action = mapHook(harness, payload);
  if (action.type === 'ignore') process.exit(0);

  if (action.type === 'event') {
    let event = action.event;
    // Claude's Stop payload doesn't carry the last message — enrich from the
    // transcript tail (codex carries it directly; map.ts already set it).
    if (harness === 'claude' && event.kind === 'stop') {
      const transcriptPath = payload.transcript_path;
      if (typeof transcriptPath === 'string') {
        const lastMessage = lastAssistantMessage(transcriptPath);
        if (lastMessage !== undefined) event = { kind: 'stop', lastMessage };
      }
    }
    try {
      await request(
        { cmd: 'hook', sessionId, event, ts: Date.now() },
        { timeoutMs: HOOK_REQUEST_TIMEOUT_MS },
      );
    } catch {
      // daemon down — fail silently, never block the agent
    }
    process.exit(0);
  }

  // permission — held connection; daemon replies with the decision (or
  // 'timeout' when the hold deadline passes without a remote answer).
  try {
    const response = await request(
      {
        cmd: 'permission',
        sessionId,
        tool: action.tool,
        input: action.input,
        timeoutMs: PERMISSION_HOLD_MS,
        ts: Date.now(),
      },
      { timeoutMs: PERMISSION_SOCKET_TIMEOUT_MS },
    );
    if (
      response.ok &&
      'decision' in response &&
      (response.decision === 'allow' || response.decision === 'deny')
    ) {
      process.stdout.write(
        `${JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: { behavior: response.decision },
          },
        })}\n`,
      );
    }
    // 'timeout' or unexpected response → no output → in-pane dialog
  } catch {
    // daemon down / socket timeout → no output → in-pane dialog
  }
  process.exit(0);
}

main().catch(() => process.exit(0));
