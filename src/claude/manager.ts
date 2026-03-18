import type {
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { DEFAULT_MODEL } from '@/constants';
import { getConvexClient, getConvexHttpClient } from '@/server/convex-client';

/** Permission mode for a session's canUseTool behavior. */
export type PermissionMode = 'default' | 'safe-auto' | 'bypass';

const VALID_PERMISSION_MODES = new Set<PermissionMode>([
  'default',
  'safe-auto',
  'bypass',
]);

export type SessionStatus = 'running' | 'waiting_input' | 'idle' | 'failed';

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
  eventBuffer: BufferedEvent[];
  batchIndex: number;
  flushing: boolean;
  sdkSessionId?: string;
  convexSessionId: string;
  permissionMode: PermissionMode;
  model?: string;
  /** The live SDK query object — used to inject follow-up messages. */
  sdkQuery?: Query;
  /** Channel for pushing follow-up messages into the running SDK process. */
  messageChannel: SdkMessageChannel;
}

const sessions = new Map<string, Session>();

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

  push(msg: SDKUserMessage): boolean {
    if (this.done) return false;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: msg, done: false });
    } else {
      this.queue.push(msg);
    }
    return true;
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
    if (!client) {
      session.eventBuffer.unshift(...events);
      return;
    }
    await client.mutation(api.sessionEvents.companionInsertBatch, {
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
    data: JSON.stringify(event),
    timestamp: Date.now(),
  });
  void flushEvents(session);
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
 * events to Convex.
 *
 * **New session** — omit `resumeSdkSessionId`. A fresh conversation starts with
 * `prompt` as the first user message.
 *
 * **Resume** — pass the `sdkSessionId` from a previous idle session. The SDK
 * picks up the conversation context and treats `prompt` as a follow-up message.
 *
 * The function returns as soon as the background iterator is launched. Actual
 * SDK events are persisted to Convex for the frontend to subscribe to.
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
      const httpClient = getConvexHttpClient();
      if (!httpClient) throw new Error('Convex client not initialized');
      const result = await httpClient.query(
        api.sessionEvents.companionGetNextBatchIndex,
        { sessionId: sessionId as Id<'sessions'> },
      );
      initialBatchIndex = result.nextBatchIndex;
    } catch (err) {
      console.error('Failed to fetch next batch index:', err);
      throw new Error('Cannot resume session: failed to determine batch index');
    }
  }

  const session: Session = {
    controller,
    stoppedByUser: false,
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
    const client = getConvexClient();
    if (client) {
      await client.mutation(api.sessions.companionUpdateName, {
        id: sessionId as Id<'sessions'>,
        name: sessionName,
      });
    }
  } catch (err) {
    console.error('Failed to set session name:', err);
  }

  // Build SDK options.
  // Strip Claude Code env vars — if the Holophyte server is itself launched from
  // a Claude Code session, spawned SDK sessions inherit these and may refuse to
  // start or misidentify as third-party usage.
  const sdkEnv = { ...process.env };
  delete sdkEnv.CLAUDECODE;
  delete sdkEnv.CLAUDE_CODE_ENTRYPOINT;
  delete sdkEnv.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;

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

      // Write approval request to Convex
      const approvalClient = getConvexClient();
      if (approvalClient) {
        await approvalClient.mutation(api.pendingApprovals.companionCreate, {
          sessionId: session.convexSessionId as Id<'sessions'>,
          requestId,
          tool: toolName,
          input: JSON.stringify(input),
        });
      }

      // Poll Convex for resolution
      return new Promise<PermissionResult>((resolve) => {
        const intervalId = setInterval(async () => {
          try {
            const approvalHttpClient = getConvexHttpClient();
            if (!approvalHttpClient) return;
            const resolved = await approvalHttpClient.query(
              api.pendingApprovals.companionListResolvedUnconsumed,
              {
                sessionId: session.convexSessionId as Id<'sessions'>,
              },
            );

            const match = resolved?.find((r) => r.requestId === requestId);
            if (match) {
              clearInterval(intervalId);
              try {
                const markClient = getConvexClient();
                if (markClient) {
                  await markClient.mutation(
                    api.pendingApprovals.companionMarkConsumed,
                    { id: match._id },
                  );
                }
              } catch (err) {
                console.error('Failed to mark approval consumed:', err);
              }
              if (match.approved) {
                resolve({ behavior: 'allow', toolUseID: toolOpts.toolUseID });
              } else {
                resolve({
                  behavior: 'deny',
                  message: 'User denied the tool call',
                  toolUseID: toolOpts.toolUseID,
                });
              }
            }
          } catch (err) {
            console.error('Failed to poll pending approvals:', err);
          }
        }, 500);

        // Auto-deny on abort so we don't leak promises
        toolOpts.signal.addEventListener(
          'abort',
          () => {
            clearInterval(intervalId);
            resolve({
              behavior: 'deny',
              message: 'Session aborted',
              toolUseID: toolOpts.toolUseID,
            });
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

    // Show the initial prompt as the first user message in the conversation
    const promptEvent = {
      type: 'user',
      uuid: crypto.randomUUID(),
      message: { role: 'user', content: prompt },
    } as SDKMessage;
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
          const sdkClient = getConvexClient();
          if (sdkClient) {
            await sdkClient.mutation(api.sessions.companionUpdateSdkSessionId, {
              id: session.convexSessionId as Id<'sessions'>,
              sdkSessionId: session.sdkSessionId,
              model: session.model,
              permissionMode: session.permissionMode,
            });
          }
        } catch (err) {
          console.error('Failed to persist SDK session ID:', err);
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

      // Update lastActivityAt on significant events
      if (event.type === 'result' || event.type === 'assistant') {
        const activityClient = getConvexClient();
        if (activityClient) {
          activityClient
            .mutation(api.sessions.companionUpdateActivity, {
              id: session.convexSessionId as Id<'sessions'>,
            })
            .catch((err: unknown) => {
              console.error('Failed to update session activity:', err);
            });
        }
      }
    }
  } catch (err) {
    console.error(`[session ${sessionId}] SDK error:`, err);
    if (!session.stoppedByUser) {
      finalStatus = 'failed';
    }
  } finally {
    // Close the message channel so streamInput() resolves
    session.messageChannel.close();

    // Flush remaining buffered events
    await flushEvents(session);

    // Deny all pending Convex approvals
    try {
      const denyClient = getConvexClient();
      if (denyClient) {
        await denyClient.mutation(api.pendingApprovals.companionDenyAll, {
          sessionId: session.convexSessionId as Id<'sessions'>,
        });
      }
    } catch (err) {
      console.error('Failed to deny remaining approvals:', err);
    }

    // Update session status in Convex
    try {
      const statusClient = getConvexClient();
      if (statusClient) {
        await statusClient.mutation(api.sessions.companionUpdateStatus, {
          id: session.convexSessionId as Id<'sessions'>,
          status: finalStatus,
        });
      }
    } catch (err) {
      console.error('Failed to update session status in Convex:', err);
    }

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

/**
 * Injects a follow-up message into a running SDK session.
 *
 * Pushes the message to the session's {@link SdkMessageChannel}, which is
 * connected to the SDK via {@link Query.streamInput}. Also buffers it for
 * Convex persistence.
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

  const pushed = session.messageChannel.push(userMsg);
  if (!pushed) return false;

  // Persist to Convex
  bufferEvent(session, userMsg);

  return true;
}
