import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { ConvexHttpClient } from 'convex/browser';
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

export type SessionStatus =
  | 'running'
  | 'waiting_input'
  | 'completed'
  | 'failed'
  | 'stopped';

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
  data: unknown;
  timestamp: number;
}

/** How long to wait for a follow-up message after the SDK turn completes. */
const IDLE_TIMEOUT_MS = 60_000;

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
  /** Resolves the idle-timeout promise when a follow-up message arrives. */
  idleResolve?: (text: string) => void;
  /** Message queued while the session is running; delivered when the turn ends. */
  pendingMessage?: string;
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

let convexClient: ConvexHttpClient | null = null;

function getConvexClient(): ConvexHttpClient {
  if (!convexClient) {
    const url = process.env.CONVEX_URL;
    if (!url) throw new Error('CONVEX_URL environment variable is not set');
    convexClient = new ConvexHttpClient(url);
  }
  return convexClient;
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
    const client = getConvexClient();
    await client.mutation(api.sessionEvents.insertBatch, {
      sessionId: session.convexSessionId as Id<'sessions'>,
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
    data: event,
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

export async function startSession(opts: {
  sessionId: string;
  repoPath: string;
  prompt: string;
  model?: string;
  permissionMode?: PermissionMode;
  resumeSdkSessionId?: string;
}): Promise<{ sessionId: string }> {
  const { sessionId } = opts;
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

  return { sessionId };
}

async function consumeIterator(
  session: Session,
  sessionId: string,
  prompt: string,
  options: Parameters<typeof sdkQuery>[0]['options'],
): Promise<void> {
  let finalStatus: SessionStatus = 'completed';

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

    // Consume SDK events, then wait for follow-up messages in a loop
    let currentIterator: AsyncIterable<SDKMessage> = iterator;
    let waitingForInput = false;

    while (true) {
      for await (const event of currentIterator) {
        // If we were idle-waiting, we're back to running
        if (waitingForInput) {
          waitingForInput = false;
          broadcast(session, {
            type: 'status',
            sessionId,
            status: 'running',
          });
        }

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
            const client = getConvexClient();
            await client.mutation(api.sessions.updateSdkSessionId, {
              id: session.convexSessionId as Id<'sessions'>,
              sdkSessionId: session.sdkSessionId,
              model: session.model,
              permissionMode: session.permissionMode,
            });
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
      }

      // Iterator finished — deliver a queued message immediately, or wait for input
      waitingForInput = true;
      broadcast(session, {
        type: 'status',
        sessionId,
        status: 'waiting_input',
      });

      // If a message was queued while the session was running, use it now
      let followUp: string | null;
      if (session.pendingMessage) {
        followUp = session.pendingMessage;
        session.pendingMessage = undefined;
      } else {
        followUp = await new Promise<string | null>((resolve) => {
          const timeoutHandle = setTimeout(
            () => resolve(null),
            IDLE_TIMEOUT_MS,
          );
          session.idleResolve = (text: string) => {
            clearTimeout(timeoutHandle);
            resolve(text);
          };
        });
        session.idleResolve = undefined;
      }

      if (!followUp) break; // Timeout — complete the session

      // Synthesize a user event for the follow-up message
      const userEvent = {
        type: 'user',
        uuid: crypto.randomUUID(),
        message: { role: 'user', content: followUp },
      } as SDKMessage;
      broadcast(session, { type: 'event', sessionId, event: userEvent });
      bufferEvent(session, userEvent);

      // Start a new SDK query with the follow-up, resuming the session
      currentIterator = sdkQuery({
        prompt: followUp,
        options: {
          ...options,
          resume: session.sdkSessionId,
        },
      });
      session.sdkQuery = currentIterator as Query;
    }
  } catch (err) {
    if (session.stoppedByUser) {
      finalStatus = 'stopped';
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
      const client = getConvexClient();
      await client.mutation(api.sessions.serverUpdateStatus, {
        id: session.convexSessionId as Id<'sessions'>,
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
 * Inject a follow-up user message into a running session.
 * Uses the SDK's `streamInput` to send the message as a new conversation turn.
 *
 * @returns true if the message was queued, false if the session is not found or has no live query.
 */
export function sendSessionMessage(sessionId: string, text: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;

  // If the session is idle-waiting for input, resolve the promise immediately
  if (session.idleResolve) {
    session.idleResolve(text);
    return true;
  }

  // Session is still running — queue the message for delivery after the turn ends
  if (session.sdkQuery) {
    session.pendingMessage = text;
    return true;
  }

  return false;
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
      event: buffered.data as SDKMessage,
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
