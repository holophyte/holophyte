import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import {
  type AppServerClient,
  type AppServerClientApprovalResponse,
  type AppServerClientEventMethod,
  type AppServerClientInboundApprovalRequest,
  type AppServerClientNotification,
  createClient,
} from 'codex-app-server-client';
import { DEFAULT_CODEX_MODEL } from '@/constants';
import { getConvexClient, getConvexHttpClient } from '@/server/convex-client';

export type PermissionMode = 'default' | 'safe-auto' | 'bypass';

const VALID_PERMISSION_MODES = new Set<PermissionMode>([
  'default',
  'safe-auto',
  'bypass',
]);

type ReasoningEffort = NonNullable<
  Parameters<AppServerClient['turn']['start']>[0]['effort']
>;
type ApprovalPolicy = NonNullable<
  Parameters<AppServerClient['turn']['start']>[0]['approvalPolicy']
>;

interface BufferedEvent {
  type: string;
  data: string;
  timestamp: number;
}

interface Session {
  client: AppServerClient;
  threadId: string;
  currentTurnId?: string;
  /** ID of the most recently completed turn — used to suppress the
   * `turn.start` response-id fallback once that turn has already terminated. */
  lastCompletedTurnId?: string;
  controller: AbortController;
  eventBuffer: BufferedEvent[];
  batchIndex: number;
  flushing: boolean;
  stoppedByUser: boolean;
  permissionMode: PermissionMode;
  model: string;
  reasoningEffort?: ReasoningEffort;
  convexSessionId: string;
  unsubscribers: Array<() => void>;
}

const sessions = new Map<string, Session>();

const MAX_ACTIVE_SESSIONS = 10;
const WARN_ACTIVE_SESSIONS = 5;
const STOP_GRACE_MS = 500;

const CODEX_EVENT_METHODS: AppServerClientEventMethod[] = [
  'error',
  'thread/started',
  'thread/status/changed',
  'thread/archived',
  'thread/unarchived',
  'thread/closed',
  'skills/changed',
  'thread/name/updated',
  'thread/tokenUsage/updated',
  'turn/started',
  'hook/started',
  'turn/completed',
  'hook/completed',
  'turn/diff/updated',
  'turn/plan/updated',
  'item/started',
  'item/autoApprovalReview/started',
  'item/autoApprovalReview/completed',
  'item/completed',
  'rawResponseItem/completed',
  'item/agentMessage/delta',
  'item/plan/delta',
  'command/exec/outputDelta',
  'item/commandExecution/outputDelta',
  'item/commandExecution/terminalInteraction',
  'item/fileChange/outputDelta',
  'serverRequest/resolved',
  'item/mcpToolCall/progress',
  'mcpServer/oauthLogin/completed',
  'mcpServer/startupStatus/updated',
  'account/updated',
  'account/rateLimits/updated',
  'app/list/updated',
  'fs/changed',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/summaryPartAdded',
  'item/reasoning/textDelta',
  'thread/compacted',
  'model/rerouted',
  'deprecationNotice',
  'configWarning',
  'fuzzyFileSearch/sessionUpdated',
  'fuzzyFileSearch/sessionCompleted',
  'thread/realtime/started',
  'thread/realtime/itemAdded',
  'thread/realtime/transcriptUpdated',
  'thread/realtime/outputAudio/delta',
  'thread/realtime/sdp',
  'thread/realtime/error',
  'thread/realtime/closed',
  'windows/worldWritableWarning',
  'windowsSandbox/setupCompleted',
  'account/login/completed',
];

function normalizeReasoningEffort(
  reasoningEffort: string | undefined,
): ReasoningEffort | undefined {
  if (
    reasoningEffort === 'minimal' ||
    reasoningEffort === 'low' ||
    reasoningEffort === 'medium' ||
    reasoningEffort === 'high'
  ) {
    return reasoningEffort;
  }
  return undefined;
}

function approvalPolicyForMode(mode: PermissionMode): ApprovalPolicy {
  // Holophyte's `default` mode means "prompt for every tool" — match that
  // semantic with Codex's `'untrusted'` policy, the only one that actually
  // confirms every operation. The spec's safety matrix called for
  // `'on-request'`, but in practice Codex's `'on-request'` only prompts on
  // higher-risk operations — sandbox-permitted edits/commands run silently,
  // which is materially weaker than Claude's `default` and surprises any
  // user who picked the strictest mode.
  //
  // `safe-auto` keeps `'on-request'` because Phase 0 has no command
  // allowlist analogous to Claude's `SAFE_BASH_PATTERNS` — a Codex-side
  // pattern-pre-filter is Phase 0.1+.
  if (mode === 'bypass') return 'never';
  if (mode === 'safe-auto') return 'on-request';
  return 'untrusted';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function flushEvents(session: Session): Promise<void> {
  if (session.eventBuffer.length === 0) return;

  while (session.flushing) {
    await sleep(50);
  }
  if (session.eventBuffer.length === 0) return;

  session.flushing = true;
  const events = [...session.eventBuffer];
  session.eventBuffer = [];

  try {
    const client = getConvexClient();
    if (!client) {
      session.eventBuffer.unshift(...events);
      return;
    }
    // Don't advance batchIndex until the mutation succeeds — otherwise a
    // failure leaves a permanent gap when the next flush retries the
    // restored events under a higher index.
    const batchIndex = session.batchIndex;
    await client.mutation(api.sessionEvents.companionInsertBatch, {
      sessionId: session.convexSessionId as Id<'sessions'>,
      events,
      batchIndex,
    });
    session.batchIndex = batchIndex + 1;
  } catch (err) {
    console.error('Failed to flush Codex events to Convex:', err);
    session.eventBuffer.unshift(...events);
  } finally {
    session.flushing = false;
  }
}

function bufferEvent(
  session: Session,
  event: AppServerClientNotification,
): void {
  session.eventBuffer.push({
    type: `codex.${event.method}`,
    data: JSON.stringify(event),
    timestamp: Date.now(),
  });
  void flushEvents(session);
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

function subscribeToEvents(session: Session): void {
  for (const method of CODEX_EVENT_METHODS) {
    const unsubscribe = session.client.onEvent(method, (notification) => {
      handleNotification(session, notification as AppServerClientNotification);
    });
    session.unsubscribers.push(unsubscribe);
  }
}

const APPROVAL_POLL_INTERVAL_MS = 500;

/**
 * Methods whose `approve()` produces a usable response shape from a single
 * binary user decision. The other three methods
 * (`item/tool/requestUserInput`, `mcpServer/elicitation/request`,
 * `item/permissions/requestApproval`) need a payload — answers, content, or
 * a permission scope — that Phase 0's UI can't collect, so an "approve"
 * click would silently send empty defaults. Structured methods are denied
 * immediately with a Phase-0.1+ marker until the rich UI lands.
 */
const BINARY_APPROVAL_METHODS = new Set<string>([
  'applyPatchApproval',
  'execCommandApproval',
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
]);

function registerApprovalHandlers(session: Session): void {
  const unsubscribe = session.client.handleApprovalRequests(
    (request: AppServerClientInboundApprovalRequest) => {
      if (!BINARY_APPROVAL_METHODS.has(request.method)) {
        console.warn(
          `[codex session ${session.convexSessionId}] denying structured approval ${request.method}: rich response collection is Phase 0.1+`,
        );
        return request.deny();
      }
      return persistAndAwaitApproval(session, request);
    },
  );
  session.unsubscribers.push(unsubscribe);
}

/**
 * Persist a Codex binary approval to `pendingApprovals`, then poll Convex
 * until the frontend resolves it. Mirrors `src/claude/manager.ts`'s
 * `canUseTool` flow, with two differences:
 *
 * - `tool` is prefixed `codex.<method>` so the frontend can route to a
 *   Codex approval renderer; the existing `pendingApprovals` schema
 *   absorbs the four supported shapes via the JSON `input` field.
 * - The library's normalized `request.approve()` / `request.deny()`
 *   produce the right response shape per method, so the handler doesn't
 *   branch on `request.method`.
 *
 * Only the four binary approval methods reach this function — structured
 * methods (user input, MCP elicitation, permission scopes) are denied
 * upstream because Phase 0's UI can't collect their required payloads.
 */
async function persistAndAwaitApproval(
  session: Session,
  request: AppServerClientInboundApprovalRequest,
): Promise<AppServerClientApprovalResponse> {
  const requestId = String(request.id);
  const sessionId = session.convexSessionId as Id<'sessions'>;

  if (session.controller.signal.aborted) return request.deny();

  const convexClient = getConvexClient();
  if (!convexClient) return request.deny();

  try {
    await convexClient.mutation(api.pendingApprovals.companionCreate, {
      sessionId,
      requestId,
      tool: `codex.${request.method}`,
      input: JSON.stringify(request.rawParams),
    });
  } catch (err) {
    console.error('Failed to persist Codex approval:', err);
    return request.deny();
  }

  return new Promise<AppServerClientApprovalResponse>((resolve) => {
    let intervalId: ReturnType<typeof setInterval> | undefined;
    // Auto-deny on session abort so we don't leak this promise. If a poll
    // tick is mid-await when abort fires, that tick may still call
    // resolve(request.approve()) afterwards — Promise.resolve is idempotent
    // so deny() wins by virtue of firing first. Acceptable: the session is
    // ending; any user-late approval has nothing to act on.
    const onAbort = () => {
      if (intervalId !== undefined) clearInterval(intervalId);
      resolve(request.deny());
    };
    session.controller.signal.addEventListener('abort', onAbort, {
      once: true,
    });

    intervalId = setInterval(async () => {
      try {
        const httpClient = await getConvexHttpClient();
        if (!httpClient) return;
        const resolved = await httpClient.query(
          api.pendingApprovals.companionListResolvedUnconsumed,
          { sessionId },
        );
        const match = resolved?.find((r) => r.requestId === requestId);
        if (!match) return;
        clearInterval(intervalId);
        session.controller.signal.removeEventListener('abort', onAbort);
        try {
          await convexClient.mutation(
            api.pendingApprovals.companionMarkConsumed,
            { id: match._id },
          );
        } catch (err) {
          console.error('Failed to mark Codex approval consumed:', err);
        }
        resolve(match.approved ? request.approve() : request.deny());
      } catch (err) {
        console.error('Failed to poll Codex pending approvals:', err);
      }
    }, APPROVAL_POLL_INTERVAL_MS);
  });
}

function handleNotification(
  session: Session,
  notification: AppServerClientNotification,
): void {
  if (notification.method === 'turn/started') {
    session.currentTurnId = notification.params.turn.id;
  }

  bufferEvent(session, notification);

  if (notification.method === 'turn/completed') {
    session.currentTurnId = undefined;
    session.lastCompletedTurnId = notification.params.turn.id;
    if (notification.params.turn.status === 'failed') {
      void finishSession(session.convexSessionId, 'failed');
      return;
    }
    // Idle: keep the session alive for follow-up turns. Flush any buffered
    // events but leave the Convex `status` as `'running'` — the session is
    // still active locally and the upcoming subscription dispatcher routes
    // follow-ups through `sessionMessages` → `sendMessageToSession`, not
    // `queueResume` (which `handleQueuedSession` short-circuits when a local
    // session exists). Writing `'idle'` here would create a stuck-queue race.
    void flushEvents(session);
  }
}

async function finishSession(
  sessionId: string,
  status: 'idle' | 'failed',
): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Claim ownership synchronously: deleting from the map before any await
  // ensures concurrent finishSession calls (e.g. user `stopSession` racing the
  // post-`interrupt` `turn/completed`) bail at the guard above instead of
  // double-closing the client and writing duplicate Convex statuses.
  sessions.delete(sessionId);
  session.currentTurnId = undefined;

  // Abort first so any in-flight approval handler resolves with deny() and
  // its polling interval clears. Without this, the natural-completion path
  // (idle/failed turn/completed) would leave the handler polling forever
  // after `companionDenyAll` patches the row to consumed: true (which
  // companionListResolvedUnconsumed filters out).
  if (!session.controller.signal.aborted) session.controller.abort();

  await sleep(STOP_GRACE_MS);
  await flushEvents(session);

  try {
    const client = getConvexClient();
    if (client) {
      await client.mutation(api.sessions.companionUpdateStatus, {
        id: session.convexSessionId as Id<'sessions'>,
        status,
      });
    }
  } catch (err) {
    console.error('Failed to update Codex session status in Convex:', err);
  }

  for (const unsubscribe of session.unsubscribers) {
    unsubscribe();
  }
  await session.client.close().catch((err: unknown) => {
    console.error('Failed to close Codex client:', err);
  });

  // Deny any pendingApprovals rows the user never resolved. companionDenyAll
  // is a no-op for already-resolved rows, so this is safe even after the
  // abort listener above settled in-flight handler promises.
  try {
    const client = getConvexClient();
    if (client) {
      await client.mutation(api.pendingApprovals.companionDenyAll, {
        sessionId: session.convexSessionId as Id<'sessions'>,
      });
    }
  } catch (err) {
    console.error('Failed to deny Codex pending approvals on cleanup:', err);
  }
}

// Sentinel placed in currentTurnId between accepting a follow-up and the real
// turn id arriving via turn/started. Prevents a re-entrant sendMessageToSession
// from passing the `currentTurnId` check while we're awaiting turn.start.
const TURN_PENDING_SENTINEL = '__codex_turn_pending__';

async function startTurn(
  session: Session,
  text: string,
  reasoningEffort = session.reasoningEffort,
): Promise<void> {
  const response = await session.client.turn.start({
    threadId: session.threadId,
    input: [{ type: 'text', text, text_elements: [] }],
    approvalPolicy: approvalPolicyForMode(session.permissionMode),
    effort: reasoningEffort,
  });

  // `turn/started` is the authoritative stream event, but keeping the response
  // id as a fallback avoids a brief uninterruptible gap on clients that suppress
  // the lifecycle notification. Promote the pending sentinel to the real id;
  // skip the fallback if the turn already terminated (turn/completed cleared
  // currentTurnId and recorded the id) — otherwise we'd resurrect a dead turn
  // id and break follow-ups.
  if (
    (session.currentTurnId === undefined ||
      session.currentTurnId === TURN_PENDING_SENTINEL) &&
    session.lastCompletedTurnId !== response.turn.id
  ) {
    session.currentTurnId = response.turn.id;
  }
}

export async function startSession(opts: {
  sessionId: string;
  repoPath: string;
  prompt: string;
  model?: string;
  permissionMode: PermissionMode;
  reasoningEffort?: string;
  resumeProviderSessionId?: string;
}): Promise<{ sessionId: string; warning?: string }> {
  const { sessionId } = opts;
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

  const mode = opts.permissionMode;
  if (!mode || !VALID_PERMISSION_MODES.has(mode)) {
    throw new Error(`Invalid permissionMode: ${mode}`);
  }

  let initialBatchIndex = 0;
  if (opts.resumeProviderSessionId) {
    try {
      const httpClient = await getConvexHttpClient();
      if (!httpClient) throw new Error('Convex client not initialized');
      const result = await httpClient.query(
        api.sessionEvents.companionGetNextBatchIndex,
        { sessionId: sessionId as Id<'sessions'> },
      );
      initialBatchIndex = result.nextBatchIndex;
    } catch (err) {
      console.error('Failed to fetch next Codex batch index:', err);
      throw new Error(
        'Cannot resume Codex session: failed to determine batch index',
      );
    }
  }

  const controller = new AbortController();
  const model = opts.model ?? DEFAULT_CODEX_MODEL;
  const reasoningEffort = normalizeReasoningEffort(opts.reasoningEffort);
  const approvalPolicy = approvalPolicyForMode(mode);

  const codexEnv = { ...process.env };
  delete codexEnv.CLAUDECODE;
  delete codexEnv.CLAUDE_CODE_ENTRYPOINT;

  const client = await createClient({
    cwd: opts.repoPath,
    env: codexEnv,
  });

  try {
    const threadResponse = opts.resumeProviderSessionId
      ? await client.thread.resume({
          threadId: opts.resumeProviderSessionId,
          cwd: opts.repoPath,
          model,
          approvalPolicy,
          sandbox: mode === 'bypass' ? 'danger-full-access' : 'workspace-write',
          persistExtendedHistory: false,
        })
      : await client.thread.start({
          cwd: opts.repoPath,
          model,
          approvalPolicy,
          sandbox: mode === 'bypass' ? 'danger-full-access' : 'workspace-write',
        });

    const threadId = threadResponse.thread.id;
    const session: Session = {
      client,
      threadId,
      controller,
      eventBuffer: [],
      batchIndex: initialBatchIndex,
      flushing: false,
      stoppedByUser: false,
      permissionMode: mode,
      model,
      reasoningEffort,
      convexSessionId: sessionId,
      unsubscribers: [],
    };
    sessions.set(sessionId, session);
    subscribeToEvents(session);
    registerApprovalHandlers(session);

    const convexClient = getConvexClient();
    if (convexClient) {
      await convexClient.mutation(
        api.sessions.companionUpdateProviderSessionId,
        {
          id: sessionId as Id<'sessions'>,
          providerSessionId: threadId,
          model,
          permissionMode: mode,
        },
      );
    }

    await startTurn(session, opts.prompt, reasoningEffort);
  } catch (err) {
    await client.close().catch(() => undefined);
    sessions.delete(sessionId);
    throw err;
  }

  return { sessionId, warning };
}

export function stopSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.stoppedByUser = true;
  session.controller.abort();

  void (async () => {
    try {
      if (
        session.currentTurnId &&
        session.currentTurnId !== TURN_PENDING_SENTINEL
      ) {
        await session.client.turn.interrupt({
          threadId: session.threadId,
          turnId: session.currentTurnId,
        });
      }
    } catch (err) {
      console.error('Failed to interrupt Codex turn:', err);
    } finally {
      await finishSession(sessionId, 'idle');
    }
  })();
}

export async function sendMessageToSession(
  sessionId: string,
  text: string,
  reasoningEffort?: string,
): Promise<boolean> {
  const session = sessions.get(sessionId);
  if (!session || session.currentTurnId) return false;

  // Claim the turn slot synchronously. Two pending messages dispatched
  // concurrently (e.g. via parallel `void handlePendingMessage(msg)` calls in
  // the subscription layer) would otherwise both pass the guard above and
  // open overlapping turns on the same Codex thread.
  session.currentTurnId = TURN_PENDING_SENTINEL;

  // Only honor an effort change when the caller explicitly supplied one.
  // Production callers (queued follow-ups in subscriptions.ts) often omit
  // this; treating that as a request to clear the override would silently
  // drop the user's chosen effort on every queued follow-up.
  const effort =
    reasoningEffort !== undefined
      ? normalizeReasoningEffort(reasoningEffort)
      : session.reasoningEffort;
  if (reasoningEffort !== undefined) {
    session.reasoningEffort = effort;
  }

  try {
    await startTurn(session, text, effort);
    return true;
  } catch (err) {
    console.error(`[codex session ${sessionId}] failed to start turn:`, err);
    // Release the sentinel so the next polling tick can retry the message.
    // finishSession will also clear it, but bailing here avoids a poisoned
    // slot if the failure path never reaches finishSession.
    if (session.currentTurnId === TURN_PENDING_SENTINEL) {
      session.currentTurnId = undefined;
    }
    void finishSession(sessionId, 'failed');
    return false;
  }
}
