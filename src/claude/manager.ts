import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { DEFAULT_MODEL } from '@/constants';

/** Permission mode for a session's canUseTool behavior. */
export type PermissionMode = 'default' | 'safe-auto' | 'bypass';

const VALID_PERMISSION_MODES = new Set<PermissionMode>([
  'default',
  'safe-auto',
  'bypass',
]);

/** JSON messages sent to WebSocket subscribers. */
export type WsServerMessage =
  | { type: 'event'; sessionId: string; event: SDKMessage }
  | {
      type: 'permission';
      sessionId: string;
      requestId: string;
      tool: string;
      input: Record<string, unknown>;
    }
  | { type: 'status'; sessionId: string; status: SessionStatus }
  | { type: 'error'; sessionId: string; message: string };

export type SessionStatus = 'running' | 'waiting_input' | 'idle' | 'failed';

interface PendingApproval {
  resolve: (result: PermissionResult) => void;
  toolName: string;
  input: Record<string, unknown>;
}

type PermissionResult =
  | {
      behavior: 'allow';
      updatedInput?: Record<string, unknown>;
      toolUseID?: string;
    }
  | {
      behavior: 'deny';
      message: string;
      toolUseID?: string;
    };

interface BufferedEvent {
  type: string;
  data: string; // JSON-serialized SDKMessage
  timestamp: number;
}

/** Max concurrent active sessions globally. */
const MAX_ACTIVE_SESSIONS = 10;
/** Warn when active sessions reach this threshold. */
const WARN_ACTIVE_SESSIONS = 5;

interface Session {
  controller: AbortController;
  stoppedByUser: boolean;
  subscribers: Set<(msg: WsServerMessage) => void>;
  approvalQueue: Map<string, PendingApproval>;
  eventBuffer: BufferedEvent[];
  batchIndex: number;
  flushing: boolean;
  sdkSessionId?: string;
  convexSessionId: string;
  flushTimer?: ReturnType<typeof setInterval>;
  permissionMode: PermissionMode;
  model?: string;
  /** The live SDK query object — used to inject follow-up messages. */
  sdkQuery?: Query;
}

const sessions = new Map<string, Session>();

const FLUSH_INTERVAL_MS = 5000;
const MAX_BUFFER_SIZE = 200;

/** Bash command patterns considered safe for auto-approval in safe-auto mode. */
const SAFE_BASH_PATTERNS = [
  /^bun\s+(test|run\s+(lint|lint:fix|check|typecheck))(\s|$)/,
  /^bunx\s+(vitest|tsc|biome)(\s|$)/,
  /^git\s+(status|stash\s+list)(\s|$)/,
  // git log: only metadata flags, no patch output (-p, --full-diff, etc.)
  /^git\s+log(\s+(--oneline|--stat|--name-only|--name-status|--no-patch|-n\s*\d+|--since=\S+|--until=\S+|--author=\S+|--format=\S+))*\s*$/,
  // git diff: require at least one summary flag (prevents bare patch output and path args)
  /^git\s+diff(\s+(--stat|--name-only|--name-status|--no-patch))+\s*$/,
  // git show: only bare commit hashes (no :path which exfiltrates file contents)
  /^git\s+show\s+[a-f0-9]{7,40}\s*$/,
  /^git\s+branch\s*$/,
  /^ls(\s|$)/,
  /^pwd$/,
  /^which\s/,
  /^type\s/,
];

/** Shell operators and redirects — never auto-approve commands containing these. */
const SHELL_OPERATOR_PATTERN = /[;&|`$\n<>]|\$\(/;

/** Tools that are always safe to auto-approve (read-only operations). */
const SAFE_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'TodoRead',
]);

/** Call a Convex HTTP action endpoint with Bearer auth. */
async function callConvexInternal(
  path: string,
  body: Record<string, unknown>,
): Promise<void> {
  const baseUrl = process.env.CONVEX_SITE_URL;
  if (!baseUrl)
    throw new Error('CONVEX_SITE_URL environment variable is not set');
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret)
    throw new Error('INTERNAL_API_SECRET environment variable is not set');

  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Convex HTTP action failed (${res.status}): ${text}`);
  }
}

function broadcast(session: Session, msg: WsServerMessage): void {
  for (const cb of session.subscribers) {
    cb(msg);
  }
}

function shouldAutoApprove(
  session: Session,
  toolName: string,
  input: Record<string, unknown>,
): boolean {
  if (session.permissionMode === 'bypass') return true;
  if (session.permissionMode === 'default') return false;

  // safe-auto mode
  if (SAFE_TOOLS.has(toolName)) return true;

  if (toolName === 'Bash') {
    const command = typeof input.command === 'string' ? input.command : '';
    // Reject multi-statement commands (shell operators can bypass pattern checks)
    if (SHELL_OPERATOR_PATTERN.test(command)) return false;
    return SAFE_BASH_PATTERNS.some((pattern) => pattern.test(command));
  }

  return false;
}

async function flushEvents(session: Session): Promise<void> {
  if (session.eventBuffer.length === 0) return;

  // Wait for any in-flight flush to finish so we don't skip buffered events
  while (session.flushing) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (session.eventBuffer.length === 0) return;

  session.flushing = true;
  const events = [...session.eventBuffer];
  session.eventBuffer = [];
  const batchIndex = session.batchIndex++;

  try {
    await callConvexInternal('/api/internal/sessionEvents/insertBatch', {
      sessionId: session.convexSessionId,
      events,
      batchIndex,
    });
  } catch (err) {
    console.error('Failed to flush events to Convex:', err);
    // Re-add events to buffer on failure so they're not lost
    // Don't decrement batchIndex to avoid duplicate batch indices
    session.eventBuffer.unshift(...events);
  } finally {
    session.flushing = false;
  }
}

function bufferEvent(session: Session, event: SDKMessage): void {
  session.eventBuffer.push({
    type: event.type,
    data: JSON.stringify(event),
    timestamp: Date.now(),
  });

  if (session.eventBuffer.length >= MAX_BUFFER_SIZE) {
    void flushEvents(session);
  }
}

export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

export function getActiveSessions(): string[] {
  return Array.from(sessions.keys());
}

export function getActiveSessionCount(): number {
  return sessions.size;
}

export function isApproachingSessionLimit(): boolean {
  return sessions.size >= WARN_ACTIVE_SESSIONS;
}

export async function startSession(opts: {
  sessionId: string;
  repoPath: string;
  prompt: string;
  model?: string;
  permissionMode?: PermissionMode;
  resumeSdkSessionId?: string;
}): Promise<{ sessionId: string; warning?: string }> {
  const { sessionId } = opts;

  // Enforce concurrent session limits
  const activeCount = sessions.size;
  if (activeCount >= MAX_ACTIVE_SESSIONS) {
    throw new Error(
      `Maximum concurrent session limit reached (${MAX_ACTIVE_SESSIONS}). Stop an existing session before starting a new one.`,
    );
  }

  const warning =
    activeCount >= WARN_ACTIVE_SESSIONS
      ? `Warning: ${activeCount} active sessions running. Consider stopping idle sessions to free resources.`
      : undefined;

  const controller = new AbortController();

  const mode = opts.permissionMode ?? 'safe-auto';
  if (!VALID_PERMISSION_MODES.has(mode)) {
    throw new Error(`Invalid permissionMode: ${mode}`);
  }

  const session: Session = {
    controller,
    stoppedByUser: false,
    subscribers: new Set(),
    approvalQueue: new Map(),
    eventBuffer: [],
    batchIndex: 0,
    flushing: false,
    convexSessionId: sessionId,
    permissionMode: mode,
    model: opts.model ?? DEFAULT_MODEL,
  };

  sessions.set(sessionId, session);

  // Persist session name from first 30 chars of prompt
  const sessionName =
    opts.prompt.slice(0, 30).trim() + (opts.prompt.length > 30 ? '…' : '');
  callConvexInternal('/api/internal/sessions/updateName', {
    id: sessionId,
    name: sessionName,
  }).catch((err) => {
    console.error('Failed to set session name:', err);
  });

  // Periodic event flush to Convex
  session.flushTimer = setInterval(() => {
    flushEvents(session);
  }, FLUSH_INTERVAL_MS);

  // Build SDK options
  const sdkOptions: Parameters<typeof sdkQuery>[0]['options'] = {
    cwd: opts.repoPath,
    abortController: controller,
    canUseTool: async (toolName, input, toolOpts) => {
      if (shouldAutoApprove(session, toolName, input)) {
        return { behavior: 'allow' as const, toolUseID: toolOpts.toolUseID };
      }

      const requestId = toolOpts.toolUseID;
      if (!requestId) {
        // Deny immediately if we can't key the request — avoids Map collisions
        return { behavior: 'deny', message: 'Missing tool use ID' };
      }

      // Broadcast permission request to all WS subscribers
      broadcast(session, {
        type: 'permission',
        sessionId,
        requestId,
        tool: toolName,
        input,
      });

      // Park in the approval queue — resolved when user responds
      return new Promise<PermissionResult>((resolve) => {
        session.approvalQueue.set(requestId, { resolve, toolName, input });

        // Auto-deny on abort so we don't leak promises
        toolOpts.signal.addEventListener(
          'abort',
          () => {
            if (session.approvalQueue.has(requestId)) {
              session.approvalQueue.delete(requestId);
              resolve({
                behavior: 'deny',
                message: 'Session aborted',
                toolUseID: toolOpts.toolUseID,
              });
            }
          },
          { once: true },
        );
      });
    },
  };

  sdkOptions.model = opts.model ?? DEFAULT_MODEL;

  if (opts.resumeSdkSessionId) {
    sdkOptions.resume = opts.resumeSdkSessionId;
  }

  // Consume the SDK iterator in the background (non-blocking)
  consumeIterator(session, sessionId, opts.prompt, sdkOptions).catch((err) => {
    console.error('Unhandled error in session iterator:', err);
  });

  return { sessionId, warning };
}

async function consumeIterator(
  session: Session,
  sessionId: string,
  prompt: string,
  options: Parameters<typeof sdkQuery>[0]['options'],
): Promise<void> {
  let finalStatus: 'idle' | 'failed' = 'idle';

  try {
    const iterator = sdkQuery({ prompt, options });
    session.sdkQuery = iterator;

    broadcast(session, { type: 'status', sessionId, status: 'running' });

    // Show the initial prompt as the first user message in the conversation
    const promptEvent = {
      type: 'user',
      uuid: crypto.randomUUID(),
      message: { role: 'user', content: prompt },
    } as SDKMessage;
    broadcast(session, { type: 'event', sessionId, event: promptEvent });
    bufferEvent(session, promptEvent);

    for await (const event of iterator) {
      // Capture SDK session ID from the init event for resume support
      if (
        event.type === 'system' &&
        'subtype' in event &&
        event.subtype === 'init' &&
        'session_id' in event
      ) {
        session.sdkSessionId = String(
          (event as Record<string, unknown>).session_id,
        );

        try {
          await callConvexInternal(
            '/api/internal/sessions/updateSdkSessionId',
            {
              id: session.convexSessionId,
              sdkSessionId: session.sdkSessionId,
              model: session.model,
              permissionMode: session.permissionMode,
            },
          );
        } catch (err) {
          console.error('Failed to persist SDK session ID:', err);
        }
      }

      // Detect error results
      if (event.type === 'result' && 'is_error' in event && event.is_error) {
        finalStatus = 'failed';
      }

      // Buffer for Convex persistence
      bufferEvent(session, event);

      // Broadcast to all WebSocket subscribers
      broadcast(session, { type: 'event', sessionId, event });

      // Update lastActivityAt on significant events
      if (event.type === 'result' || event.type === 'assistant') {
        callConvexInternal('/api/internal/sessions/updateActivity', {
          id: session.convexSessionId,
        }).catch((err) => {
          console.error('Failed to update session activity:', err);
        });
      }
    }
  } catch (err) {
    if (session.stoppedByUser) {
      finalStatus = 'idle';
    } else {
      finalStatus = 'failed';
      broadcast(session, {
        type: 'error',
        sessionId,
        message: String(err),
      });
    }
  } finally {
    // Stop the periodic flush timer first to prevent races
    if (session.flushTimer) {
      clearInterval(session.flushTimer);
    }

    // Flush remaining buffered events
    await flushEvents(session);

    // Reject any pending approvals
    for (const [, pending] of session.approvalQueue) {
      pending.resolve({ behavior: 'deny', message: 'Session ended' });
    }
    session.approvalQueue.clear();

    // Update session status in Convex
    try {
      await callConvexInternal('/api/internal/sessions/updateStatus', {
        id: session.convexSessionId,
        status: finalStatus,
      });
    } catch (err) {
      console.error('Failed to update session status in Convex:', err);
    }

    // Notify subscribers of final status
    broadcast(session, { type: 'status', sessionId, status: finalStatus });

    sessions.delete(sessionId);
  }
}

export function stopSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.stoppedByUser = true;
  session.controller.abort();
}

/** Resolve a pending permission prompt (approve or deny a tool call). */
export function respondToApproval(
  sessionId: string,
  requestId: string,
  approved: boolean,
  message?: string,
): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;

  const pending = session.approvalQueue.get(requestId);
  if (!pending) return false;

  session.approvalQueue.delete(requestId);

  if (approved) {
    pending.resolve({ behavior: 'allow', toolUseID: requestId });
  } else {
    pending.resolve({
      behavior: 'deny',
      message: message ?? 'User denied the tool call',
    });
  }

  return true;
}

/**
 * Inject a follow-up user message into an actively running session.
 * Only works if the session is still running (process hasn't exited yet).
 * For idle sessions, start a new session with resumeSdkSessionId instead.
 *
 * @returns true if the message was queued, false if the session is not found or has no live query.
 */
export function sendSessionMessage(sessionId: string, _text: string): boolean {
  const session = sessions.get(sessionId);
  if (!session || !session.sdkQuery) return false;

  // Queue the message - the SDK will deliver it in-flight if supported
  // This path is only reached for sessions still actively running
  return false; // Not supported in single-turn mode; use resume flow instead
}

export function subscribe(
  sessionId: string,
  callback: (msg: WsServerMessage) => void,
): () => void {
  const session = sessions.get(sessionId);
  if (!session) return () => {};
  session.subscribers.add(callback);

  // Replay buffered events so late-connecting clients see the full history
  for (const buffered of session.eventBuffer) {
    callback({
      type: 'event',
      sessionId,
      event: JSON.parse(buffered.data) as SDKMessage,
    });
  }

  // Replay any pending approvals so late-connecting clients don't miss them
  for (const [requestId, { toolName, input }] of session.approvalQueue) {
    callback({
      type: 'permission',
      sessionId,
      requestId,
      tool: toolName,
      input,
    });
  }

  return () => {
    session.subscribers.delete(callback);
  };
}
