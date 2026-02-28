import type {
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
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
  | { type: 'error'; sessionId: string; message: string }
  | { type: 'warning'; sessionId: string; message: string };

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
  /** Channel for pushing follow-up messages into the running SDK process. */
  messageChannel: SdkMessageChannel;
  /** Whether a persistence warning has already been sent to subscribers. */
  persistenceWarned?: boolean;
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

/**
 * Push-based async iterable for injecting follow-up messages into a running
 * SDK session via {@link Query.streamInput}.
 *
 * Supports a single consumer only — creating a second iterator throws.
 *
 * Call {@link push} to enqueue a message; the SDK pulls from the iterable
 * on its own schedule. Call {@link close} when the session ends.
 */
class SdkMessageChannel implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = [];
  private waiting: ((result: IteratorResult<SDKUserMessage>) => void) | null =
    null;
  private done = false;
  private iteratorCreated = false;

  push(msg: SDKUserMessage): void {
    if (this.done) return;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: msg, done: false });
    } else {
      this.queue.push(msg);
    }
  }

  close(): void {
    this.done = true;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: undefined as unknown as SDKUserMessage, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    if (this.iteratorCreated) {
      throw new Error('SdkMessageChannel supports only a single consumer');
    }
    this.iteratorCreated = true;

    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        if (this.queue.length > 0) {
          // biome-ignore lint/style/noNonNullAssertion: length check guarantees element exists
          return Promise.resolve({ value: this.queue.shift()!, done: false });
        }
        if (this.done) {
          return Promise.resolve({
            value: undefined as unknown as SDKUserMessage,
            done: true,
          });
        }
        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
    };
  }
}

/** Call a Convex HTTP action endpoint with Bearer auth. */
let managerConfigWarningLogged = false;
function getConvexConfig(): { baseUrl: string; secret: string } | null {
  const baseUrl = process.env.CONVEX_SITE_URL;
  const secret = process.env.INTERNAL_API_SECRET;
  if (!baseUrl || !secret) {
    if (!managerConfigWarningLogged) {
      const missing = [
        !baseUrl && 'CONVEX_SITE_URL',
        !secret && 'INTERNAL_API_SECRET',
      ].filter(Boolean);
      console.error(
        `WARNING: ${missing.join(', ')} not set — session data will not be persisted to Convex`,
      );
      managerConfigWarningLogged = true;
    }
    return null;
  }
  return { baseUrl, secret };
}

async function callConvexInternal(
  path: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  const config = getConvexConfig();
  if (!config) return false;
  const { baseUrl, secret } = config;

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
  return true;
}

async function queryConvexInternal<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T | null> {
  const config = getConvexConfig();
  if (!config) return null;
  const { baseUrl, secret } = config;

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

  return (await res.json()) as T;
}

function broadcast(session: Session, msg: WsServerMessage): void {
  for (const cb of session.subscribers) {
    cb(msg);
  }
}

/** Send a persistence warning to subscribers — at most once per session. */
function warnPersistence(session: Session, sessionId: string): void {
  if (session.persistenceWarned) return;
  // Only mark as warned if there are subscribers to receive the message —
  // otherwise the flag would be set before any client connects, and later
  // failures (when clients ARE connected) would silently skip the warning.
  if (session.subscribers.size === 0) return;
  session.persistenceWarned = true;
  broadcast(session, {
    type: 'warning',
    sessionId,
    message:
      'Failed to persist session data to database — events may be lost on refresh',
  });
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
    const persisted = await callConvexInternal(
      '/api/internal/sessionEvents/insertBatch',
      {
        sessionId: session.convexSessionId,
        events,
        batchIndex,
      },
    );
    if (!persisted) {
      session.eventBuffer.unshift(...events);
      warnPersistence(session, session.convexSessionId);
    }
  } catch (err) {
    console.error('Failed to flush events to Convex:', err);
    // Re-add events to buffer on failure so they're not lost
    // Don't decrement batchIndex to avoid duplicate batch indices
    session.eventBuffer.unshift(...events);
    warnPersistence(session, session.convexSessionId);
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

/**
 * Returns the in-memory session state for a running session, or `undefined` if
 * no session with the given ID is currently active.
 *
 * Only active (running) sessions are present in memory — idle sessions exist
 * only in Convex and must be resumed via {@link startSession} with
 * `resumeSdkSessionId`.
 */
export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

/** Returns the IDs of all currently active (running) sessions. */
export function getActiveSessions(): string[] {
  return Array.from(sessions.keys());
}

/** Returns the number of currently active (running) sessions. */
export function getActiveSessionCount(): number {
  return sessions.size;
}

/**
 * Returns `true` when active sessions have reached or exceeded the warning
 * threshold (`WARN_ACTIVE_SESSIONS = 5`).
 *
 * Used by the frontend to show a caution banner before allowing new sessions to
 * be launched, without blocking the user outright.
 */
export function isApproachingSessionLimit(): boolean {
  return sessions.size >= WARN_ACTIVE_SESSIONS;
}

/**
 * Spawns a Claude Code SDK process for the given session and begins streaming
 * events to any WebSocket subscribers.
 *
 * **New session** — omit `resumeSdkSessionId`. A fresh conversation starts with
 * `prompt` as the first user message.
 *
 * **Resume** — pass the `sdkSessionId` from a previous idle session. The SDK
 * picks up the conversation context and treats `prompt` as a follow-up message.
 *
 * The function returns as soon as the background iterator is launched. Actual
 * SDK events arrive asynchronously via {@link subscribe}.
 *
 * @throws If the global active session cap (`MAX_ACTIVE_SESSIONS = 10`) is reached.
 * @throws If `permissionMode` is not one of `'default' | 'safe-auto' | 'bypass'`.
 *
 * @returns The `sessionId` echoed back, and an optional `warning` string when
 *   the session count is at or above the warning threshold.
 */
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

  // When resuming, start batchIndex after existing persisted batches so new
  // events sort after the previous session's history.
  let initialBatchIndex = 0;
  if (opts.resumeSdkSessionId) {
    try {
      const result = await queryConvexInternal<{
        nextBatchIndex: number;
      }>('/api/internal/sessionEvents/getNextBatchIndex', { sessionId });
      if (!result) throw new Error('Convex not configured');
      initialBatchIndex = result.nextBatchIndex;
    } catch (err) {
      console.error('Failed to fetch next batch index:', err);
      throw new Error('Cannot resume session: failed to determine batch index');
    }
  }

  const session: Session = {
    controller,
    stoppedByUser: false,
    subscribers: new Set(),
    approvalQueue: new Map(),
    eventBuffer: [],
    batchIndex: initialBatchIndex,
    flushing: false,
    convexSessionId: sessionId,
    permissionMode: mode,
    model: opts.model ?? DEFAULT_MODEL,
    messageChannel: new SdkMessageChannel(),
  };

  sessions.set(sessionId, session);

  // Persist session name from first 30 chars of prompt
  const sessionName =
    opts.prompt.slice(0, 30).trim() + (opts.prompt.length > 30 ? '…' : '');
  try {
    const persisted = await callConvexInternal(
      '/api/internal/sessions/updateName',
      {
        id: sessionId,
        name: sessionName,
      },
    );
    if (!persisted) {
      warnPersistence(session, sessionId);
    }
  } catch (err) {
    console.error('Failed to set session name:', err);
    warnPersistence(session, sessionId);
  }

  // Periodic event flush to Convex
  session.flushTimer = setInterval(() => {
    flushEvents(session);
  }, FLUSH_INTERVAL_MS);

  // Build SDK options.
  // Strip CLAUDECODE env var — if the Holophyte server is itself launched from
  // a Claude Code session, spawned SDK sessions inherit it and refuse to start
  // ("cannot be launched inside another Claude Code session").
  const sdkEnv = { ...process.env };
  delete sdkEnv.CLAUDECODE;

  const sdkOptions: Parameters<typeof sdkQuery>[0]['options'] = {
    cwd: opts.repoPath,
    env: sdkEnv,
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

    // Connect the message channel so follow-up messages can be injected.
    // Fire-and-forget — the promise stays pending until the channel closes.
    iterator.streamInput(session.messageChannel).catch((err) => {
      console.error(`[session ${sessionId}] streamInput error:`, err);
    });

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
          const persisted = await callConvexInternal(
            '/api/internal/sessions/updateSdkSessionId',
            {
              id: session.convexSessionId,
              sdkSessionId: session.sdkSessionId,
              model: session.model,
              permissionMode: session.permissionMode,
            },
          );
          if (!persisted) {
            warnPersistence(session, sessionId);
          }
        } catch (err) {
          console.error('Failed to persist SDK session ID:', err);
          warnPersistence(session, sessionId);
        }
      }

      // Detect error results
      if (event.type === 'result' && 'is_error' in event && event.is_error) {
        console.error(
          `[session ${sessionId}] SDK result error:`,
          (event as Record<string, unknown>).error,
        );
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
        })
          .then((persisted) => {
            if (!persisted) {
              warnPersistence(session, sessionId);
            }
          })
          .catch((err) => {
            console.error('Failed to update session activity:', err);
            warnPersistence(session, sessionId);
          });
      }
    }
  } catch (err) {
    console.error(`[session ${sessionId}] SDK error:`, err);
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
    // Close the message channel so streamInput() resolves
    session.messageChannel.close();

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
      const persisted = await callConvexInternal(
        '/api/internal/sessions/updateStatus',
        {
          id: session.convexSessionId,
          status: finalStatus,
        },
      );
      if (!persisted) {
        warnPersistence(session, sessionId);
      }
    } catch (err) {
      console.error('Failed to update session status in Convex:', err);
      warnPersistence(session, sessionId);
    }

    // Notify subscribers of final status
    broadcast(session, { type: 'status', sessionId, status: finalStatus });

    sessions.delete(sessionId);
  }
}

/**
 * Aborts the running SDK process for a session.
 *
 * Sets `stoppedByUser = true` so the cleanup path in `consumeIterator` treats
 * the abort as a user-initiated stop rather than an error, transitioning the
 * session to `idle` (resumable) instead of `failed`.
 *
 * No-op if the session is not currently active.
 */
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
 * Subscribes to WebSocket messages for an active session.
 *
 * Immediately replays any buffered events (un-flushed SDK messages still in
 * memory) and any pending permission prompts so late-connecting clients see the
 * complete in-progress state. Subsequent events are delivered in real-time via
 * `callback`.
 *
 * @param sessionId - The Convex session ID of the active session.
 * @param callback - Invoked for each {@link WsServerMessage} (event, permission,
 *   status, or error).
 * @returns An unsubscribe function. Call it in the WebSocket `close` handler.
 */
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

/**
 * Injects a follow-up message into a running SDK session.
 *
 * Pushes the message to the session's {@link MessageChannel}, which is
 * connected to the SDK via {@link Query.streamInput}. Also broadcasts the
 * user message to WebSocket subscribers and buffers it for Convex persistence.
 *
 * @param sessionId - The Convex session ID.
 * @param text - The message text to inject.
 * @returns `true` if the message was delivered, `false` if the session is not
 *   running or not yet initialized.
 */
export function sendMessageToSession(sessionId: string, text: string): boolean {
  const session = sessions.get(sessionId);
  // sdkSessionId is set from the system/init event — if not yet available,
  // return false so the message stays unconsumed and retries on the next poll.
  if (!session?.sdkQuery || !session.sdkSessionId) return false;

  const userMsg: SDKUserMessage = {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    uuid: crypto.randomUUID(),
    session_id: session.sdkSessionId,
  };

  session.messageChannel.push(userMsg);

  // Show the message in the conversation UI and persist to Convex
  broadcast(session, { type: 'event', sessionId, event: userMsg });
  bufferEvent(session, userMsg);

  return true;
}
