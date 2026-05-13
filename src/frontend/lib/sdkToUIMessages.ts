import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { UIMessage } from 'ai';
import type { PendingApproval } from '@/frontend/hooks/useSession';

/**
 * A `DynamicToolUIPart` as defined by the `ai` package.
 * We use the dynamic variant because Claude tools have arbitrary names.
 */
type DynamicToolUIPart =
  | {
      type: 'dynamic-tool';
      toolName: string;
      toolCallId: string;
      state: 'input-streaming';
      input: unknown;
    }
  | {
      type: 'dynamic-tool';
      toolName: string;
      toolCallId: string;
      state: 'input-available';
      input: unknown;
    }
  | {
      type: 'dynamic-tool';
      toolName: string;
      toolCallId: string;
      state: 'approval-requested';
      input: unknown;
      approval: {
        id: string;
        codex?: { tool: string; input: Record<string, unknown> };
      };
    }
  | {
      type: 'dynamic-tool';
      toolName: string;
      toolCallId: string;
      state: 'output-available';
      input: unknown;
      output: unknown;
    }
  | {
      type: 'dynamic-tool';
      toolName: string;
      toolCallId: string;
      state: 'output-error';
      input: unknown;
      errorText: string;
    }
  | {
      type: 'dynamic-tool';
      toolName: string;
      toolCallId: string;
      state: 'approval-responded';
      input: unknown;
      approval: {
        id: string;
        approved: true;
        codex?: { tool: string; input: Record<string, unknown> };
      };
    }
  | {
      type: 'dynamic-tool';
      toolName: string;
      toolCallId: string;
      state: 'output-denied';
      input: unknown;
      approval: {
        id: string;
        approved: false;
        codex?: { tool: string; input: Record<string, unknown> };
      };
    };

/**
 * Transforms an array of SDK events into `UIMessage[]` for use with the `ai`
 * package's UI primitives.
 *
 * @param events - Accumulated SDK events from `useSession`.
 * @param isRunning - When `true`, the last assistant message is marked as
 *   streaming (text parts get `state: 'streaming'`); otherwise `'done'`.
 * @param pendingApprovals - Approval requests from the Convex
 *   `pendingApprovals` table. Rows whose `tool` name matches an SDK
 *   `tool_use_id` flip the corresponding part to `approval-requested`
 *   (or `approval-responded` / `output-denied` once resolved). Rows
 *   whose `tool` is prefixed `codex.` are bridged from the Codex
 *   approval handler — the renderer overlays them onto the matching
 *   Codex tool message keyed by `codex-${itemId}` and stamps an
 *   `approval.codex` marker so the consuming UI can render Codex copy.
 */
export function sdkToUIMessages(
  events: SDKMessage[],
  isRunning: boolean,
  pendingApprovals: PendingApproval[],
): UIMessage[] {
  // Set of requestIds that still need user action
  const unresolvedIds = new Set(
    pendingApprovals.filter((a) => !a.resolved).map((a) => a.requestId),
  );

  // Map of requestId → approved boolean for resolved approvals
  const resolvedApprovals = new Map<string, boolean>(
    pendingApprovals
      .filter((a) => a.resolved !== undefined)
      .map((a) => [a.requestId, a.resolved?.approved ?? false]),
  );

  // Codex approvals are bridged through `pendingApprovals` with
  // `tool: 'codex.<method>'` and `requestId` keyed by the Codex item id
  // (which equals the rendered tool message's `toolCallId`). Indexed
  // separately so the Codex post-pass can override the tool part state
  // without mixing with SDK approval matching above.
  const codexApprovalsByItemId = new Map<string, PendingApproval>();
  for (const a of pendingApprovals) {
    if (a.tool?.startsWith('codex.')) {
      codexApprovalsByItemId.set(a.requestId, a);
    }
  }

  // First pass: collect tool results keyed by tool_use_id
  const toolResults = new Map<string, { result: string; isError: boolean }>();

  for (const event of events) {
    if (event.type === 'user') {
      const msg = event.message as { content?: unknown[] };
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          const b = block as Record<string, unknown>;
          if (b.type === 'tool_result') {
            const toolUseId = String(b.tool_use_id ?? '');
            const content = b.content;
            let resultText = '';
            if (typeof content === 'string') {
              resultText = content;
            } else if (Array.isArray(content)) {
              resultText = (content as Array<Record<string, unknown>>)
                .filter((c) => c.type === 'text')
                .map((c) => String(c.text ?? ''))
                .join('');
            }
            toolResults.set(toolUseId, {
              result: resultText,
              isError: b.is_error === true,
            });
          }
        }
      }
    }
  }

  // Deduplicate assistant events by stable ID — the SDK sends progressive
  // snapshots of the same message (e.g., first with thinking, then with
  // tool_use). Keep the LAST snapshot for each stable ID since it has the
  // most complete content. Use message.id when available, fall back to uuid.
  const lastAssistantById = new Map<
    string,
    { event: SDKMessage; stableId: string }
  >();
  for (const event of events) {
    if (event.type === 'assistant') {
      const msg = event.message as { id?: string };
      const uuid = (event as { uuid?: string }).uuid ?? '';
      const stableId = String(msg.id ?? uuid);
      if (stableId) {
        lastAssistantById.set(stableId, { event, stableId });
      }
    }
  }

  const messages: UIMessage[] = [];
  // Track which stable IDs we've already emitted to avoid duplicates
  const emittedIds = new Set<string>();
  const lastAssistantEvent = events
    .filter((e) => e.type === 'assistant')
    .at(-1);

  // Codex agent-message text accumulator (delta → in-place merge)
  const codexAgentText = new Map<string, string>();
  // Set of Codex agentMessage itemIds that received an `item/completed`.
  // These are authoritative — never re-marked as streaming in the post-pass.
  const codexCompletedAgentIds = new Set<string>();
  // Track the most recent Codex agentMessage itemId so we can mark it as
  // 'streaming' when a turn is in flight. Updated as agentMessage events flow.
  let lastCodexAgentItemId: string | null = null;
  // Whether a Codex turn is currently in flight (turn/started seen with no
  // matching turn/completed). When true and isRunning, the most recent
  // agent-message bubble is marked as streaming.
  let codexTurnActive = false;

  // Second pass: build UIMessage entries
  for (const event of events) {
    const eventType = (event as { type?: unknown }).type;
    if (typeof eventType === 'string' && eventType.startsWith('codex.')) {
      const result = handleCodexEvent(
        event as unknown as CodexEvent,
        eventType,
        messages,
        codexAgentText,
        codexCompletedAgentIds,
        codexTurnActive,
      );
      codexTurnActive = result.turnActive;
      if (result.lastAgentItemId !== undefined) {
        lastCodexAgentItemId = result.lastAgentItemId;
      }
      continue;
    }
    if (event.type === 'assistant') {
      const msg = event.message as { id?: string; content?: unknown[] };
      const uuid = (event as { uuid?: string }).uuid ?? '';
      const stableId = String(msg.id ?? uuid);

      // Skip if we've already emitted this stable ID (use the latest snapshot)
      if (emittedIds.has(stableId)) continue;

      // Use the latest snapshot for this message
      const latest = lastAssistantById.get(stableId);
      if (!latest) continue;
      emittedIds.add(stableId);

      const latestMsg =
        (latest.event as { message?: { content?: unknown[] } }).message ?? {};
      const content = Array.isArray(latestMsg.content) ? latestMsg.content : [];

      const isLast = latest.event === lastAssistantEvent;
      const textState = isRunning && isLast ? 'streaming' : 'done';

      // biome-ignore lint/suspicious/noExplicitAny: UIMessage parts union is complex; cast via any to satisfy the generic
      const parts: any[] = [];

      for (const block of content) {
        const b = block as Record<string, unknown>;

        if (b.type === 'text') {
          const text = String(b.text ?? '');
          if (text) {
            parts.push({ type: 'text', text, state: textState });
          }
        } else if (b.type === 'tool_use') {
          const toolCallId = String(b.id ?? '');
          const toolName = String(b.name ?? '');
          // biome-ignore lint/suspicious/noExplicitAny: SDK input is untyped
          const input = (b.input ?? {}) as any;
          const toolResult = toolResults.get(toolCallId);
          const isUnresolved = unresolvedIds.has(toolCallId);

          let part: DynamicToolUIPart;

          if (isUnresolved) {
            part = {
              type: 'dynamic-tool',
              toolName,
              toolCallId,
              state: 'approval-requested',
              input,
              approval: { id: toolCallId },
            };
          } else if (toolResult !== undefined) {
            if (toolResult.isError) {
              part = {
                type: 'dynamic-tool',
                toolName,
                toolCallId,
                state: 'output-error',
                input,
                errorText: toolResult.result,
              };
            } else {
              part = {
                type: 'dynamic-tool',
                toolName,
                toolCallId,
                state: 'output-available',
                input,
                output: toolResult.result,
              };
            }
          } else if (resolvedApprovals.has(toolCallId)) {
            // Approval was resolved but tool_result hasn't arrived yet
            const approved = resolvedApprovals.get(toolCallId) ?? false;
            if (approved) {
              part = {
                type: 'dynamic-tool',
                toolName,
                toolCallId,
                state: 'approval-responded',
                input,
                approval: { id: toolCallId, approved: true },
              };
            } else {
              part = {
                type: 'dynamic-tool',
                toolName,
                toolCallId,
                state: 'output-denied',
                input,
                approval: { id: toolCallId, approved: false },
              };
            }
          } else {
            // No result yet — tool call is waiting
            part = {
              type: 'dynamic-tool',
              toolName,
              toolCallId,
              state: 'input-available',
              input,
            };
          }

          parts.push(part);
        }
      }

      if (parts.length === 0) continue;

      messages.push({
        id: latest.stableId,
        role: 'assistant',
        parts,
      });
    } else if (event.type === 'user') {
      const msg = event.message as { content?: unknown[] | string };
      const isSynthetic = (event as { isSynthetic?: boolean }).isSynthetic;
      if (isSynthetic) continue;

      let userText = '';
      if (typeof msg.content === 'string') {
        userText = msg.content;
      } else if (Array.isArray(msg.content)) {
        // Only include text blocks (not tool_result blocks)
        for (const block of msg.content) {
          const b = block as Record<string, unknown>;
          if (b.type === 'text') {
            userText += String(b.text ?? '');
          }
        }
      }

      if (!userText) continue;

      const uuid = (event as { uuid?: string }).uuid ?? crypto.randomUUID();
      messages.push({
        id: uuid,
        role: 'user',
        parts: [{ type: 'text', text: userText }],
      });
    }
    // 'result', 'system/init' and other types are ignored
  }

  // Final pass: resolve Codex agent-message text states.
  // Bubbles built from `item/agentMessage/delta` default to 'streaming' so the
  // typing animation appears live. Once their turn ends OR the session is no
  // longer running, mark non-completed ones as 'done'. The active bubble
  // (last id, turn still in flight, session running) keeps 'streaming'.
  for (const itemId of codexAgentText.keys()) {
    if (codexCompletedAgentIds.has(itemId)) continue;
    const idx = messages.findIndex((m) => m.id === `codex-${itemId}`);
    if (idx === -1) continue;
    const msg = messages[idx];
    if (!msg) continue;
    const isLive =
      isRunning && codexTurnActive && itemId === lastCodexAgentItemId;
    const targetState = isLive ? 'streaming' : 'done';
    // biome-ignore lint/suspicious/noExplicitAny: parts union is complex
    const newParts = (msg.parts as any[]).map((p) =>
      p.type === 'text' ? { ...p, state: targetState } : p,
    );
    messages[idx] = { ...msg, parts: newParts };
  }

  // Final pass: overlay Codex pending approvals onto their matching tool
  // message. The bridge persists `pendingApprovals` rows keyed by the Codex
  // item id, which equals the rendered tool message's `codex-${itemId}`.
  // Unresolved → approval-requested; resolved approve → approval-responded;
  // resolved deny → output-denied. Carries a `codex` marker on the approval
  // object so `ToolCallUI` can render Codex-specific copy.
  for (const [itemId, approval] of codexApprovalsByItemId) {
    let idx = messages.findIndex((m) => m.id === `codex-${itemId}`);
    if (idx === -1) {
      // Approval arrived before the matching item/started event (or the
      // event was dropped). Synthesize a placeholder tool message keyed
      // by the same id so the post-pass below can apply state — input
      // is left empty; the `codex` marker on the approval carries the
      // request payload for the renderer to display.
      const toolName = approvalToolName(approval.tool);
      messages.push({
        id: `codex-${itemId}`,
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName,
            toolCallId: itemId,
            state: 'input-available',
            input: {},
          },
        ],
        // biome-ignore lint/suspicious/noExplicitAny: UIMessage parts union is complex
      } as any);
      idx = messages.length - 1;
    }
    const msg = messages[idx];
    if (!msg) continue;
    // biome-ignore lint/suspicious/noExplicitAny: parts union is complex
    const newParts = (msg.parts as any[]).map((p) => {
      if (p.type !== 'dynamic-tool') return p;
      // Skip parts that already reached a terminal output state. Once Codex
      // emits `item/completed` with output / error / declined, that result
      // is the source of truth — overlaying a stale `approval-responded`
      // would hide the actual command output indefinitely (the resolved
      // approval row stays in `pendingApprovals` for the life of the
      // session).
      if (
        p.state === 'output-available' ||
        p.state === 'output-error' ||
        p.state === 'output-denied'
      ) {
        return p;
      }
      const codexMarker = { tool: approval.tool, input: approval.input };
      if (!approval.resolved) {
        return {
          type: 'dynamic-tool',
          toolName: p.toolName,
          toolCallId: p.toolCallId,
          state: 'approval-requested',
          input: p.input,
          approval: { id: itemId, codex: codexMarker },
        };
      }
      if (approval.resolved.approved) {
        return {
          type: 'dynamic-tool',
          toolName: p.toolName,
          toolCallId: p.toolCallId,
          state: 'approval-responded',
          input: p.input,
          approval: { id: itemId, approved: true, codex: codexMarker },
        };
      }
      return {
        type: 'dynamic-tool',
        toolName: p.toolName,
        toolCallId: p.toolCallId,
        state: 'output-denied',
        input: p.input,
        approval: { id: itemId, approved: false, codex: codexMarker },
      };
    });
    messages[idx] = { ...msg, parts: newParts };
  }

  return messages;
}

/**
 * Derive a sensible `toolName` from a Codex approval `tool` string when
 * synthesizing a placeholder tool message (no matching `item/started` was
 * observed). Phase 0 only bridges two methods; unknown tools fall back to
 * a generic 'Codex' label.
 */
function approvalToolName(tool: string): string {
  switch (tool) {
    case 'codex.item/commandExecution/requestApproval':
      return 'Bash';
    case 'codex.item/fileChange/requestApproval':
      return 'Edit';
    default:
      return 'Codex';
  }
}

// ---------------------------------------------------------------------------
// Codex event handling
// ---------------------------------------------------------------------------

type CodexEvent = { type: string; data: string };

interface CodexHandlerResult {
  turnActive: boolean;
  /** Updated when an agentMessage item is observed; otherwise undefined. */
  lastAgentItemId?: string;
}

/**
 * Handles a single Codex stream event (`type: 'codex.<method>'`) and mutates
 * `messages` to reflect Codex thread state. Codex events arrive as buffered
 * `{ type, data }` rows; `data` is the JSON-serialized notification payload
 * from `codex-app-server-client`. Unknown methods are silently skipped.
 */
function handleCodexEvent(
  event: CodexEvent,
  eventType: string,
  // biome-ignore lint/suspicious/noExplicitAny: UIMessage parts union is complex
  messages: any[],
  codexAgentText: Map<string, string>,
  codexCompletedAgentIds: Set<string>,
  turnActive: boolean,
): CodexHandlerResult {
  const method = eventType.slice('codex.'.length);

  // Parse payload defensively — malformed JSON shouldn't take down the renderer.
  let payload: Record<string, unknown> = {};
  try {
    const data = (event as { data?: unknown }).data;
    if (typeof data === 'string') {
      const parsed = JSON.parse(data) as { params?: unknown };
      const params = (parsed as { params?: unknown }).params;
      payload = (params ?? {}) as Record<string, unknown>;
    }
  } catch {
    return { turnActive };
  }

  switch (method) {
    case 'turn/started':
      return { turnActive: true };
    case 'turn/completed':
      return { turnActive: false };
    case 'item/agentMessage/delta': {
      const itemId = String(payload.itemId ?? '');
      const delta = String(payload.delta ?? '');
      if (!itemId) return { turnActive };
      const text = (codexAgentText.get(itemId) ?? '') + delta;
      codexAgentText.set(itemId, text);
      upsertCodexAgentMessage(messages, itemId, text);
      return { turnActive, lastAgentItemId: itemId };
    }
    case 'item/started': {
      // Phase 0: only emit placeholder messages for tool-like items so
      // long-running commands / file edits / MCP calls / web searches are
      // visible in the thread before they complete. Text items
      // (agentMessage, reasoning, userMessage) finalize on item/completed
      // or stream via dedicated delta events.
      const item = (payload.item ?? {}) as Record<string, unknown>;
      const itemId = String(item.id ?? '');
      if (!itemId) return { turnActive };
      const part = mapCodexToolItem(item, itemId, false);
      if (!part) return { turnActive };
      upsertCodexToolMessage(messages, itemId, part);
      return { turnActive };
    }
    case 'item/completed': {
      const item = (payload.item ?? {}) as Record<string, unknown>;
      const itemType = String(item.type ?? '');
      const itemId = String(item.id ?? '');
      if (!itemId) return { turnActive };

      switch (itemType) {
        case 'userMessage': {
          const content = Array.isArray(item.content)
            ? (item.content as Array<Record<string, unknown>>)
            : [];
          const textParts = content
            .filter((c) => c.type === 'text')
            .map((c) => String(c.text ?? ''))
            .filter(Boolean);
          // Non-text inputs (image/localImage/skill/mention) lose their content
          // payload in Phase 0 — the UI doesn't render attachments yet — but we
          // emit a placeholder so the turn boundary stays visible in the thread.
          const nonTextKinds = content
            .map((c) => String(c.type ?? ''))
            .filter((t) => t && t !== 'text');
          let text = textParts.join('');
          if (!text && nonTextKinds.length > 0) {
            const unique = Array.from(new Set(nonTextKinds));
            text = `[${unique.join(', ')}]`;
          }
          if (!text) return { turnActive };
          messages.push({
            id: `codex-${itemId}`,
            role: 'user',
            parts: [{ type: 'text', text }],
          });
          return { turnActive };
        }
        case 'agentMessage': {
          const text = String(item.text ?? codexAgentText.get(itemId) ?? '');
          codexAgentText.set(itemId, text);
          codexCompletedAgentIds.add(itemId);
          upsertCodexAgentMessage(messages, itemId, text, 'done');
          return { turnActive, lastAgentItemId: itemId };
        }
        case 'reasoning': {
          const summary = Array.isArray(item.summary)
            ? (item.summary as unknown[]).map(String).filter(Boolean)
            : [];
          const content = Array.isArray(item.content)
            ? (item.content as unknown[]).map(String).filter(Boolean)
            : [];
          const text = [...summary, ...content].join('\n\n');
          if (!text) return { turnActive };
          messages.push({
            id: `codex-${itemId}`,
            role: 'assistant',
            parts: [{ type: 'reasoning', text, state: 'done' }],
          });
          return { turnActive };
        }
        case 'commandExecution':
        case 'fileChange':
        case 'mcpToolCall':
        case 'webSearch':
        case 'dynamicToolCall': {
          const part = mapCodexToolItem(item, itemId, true);
          if (!part) return { turnActive };
          upsertCodexToolMessage(messages, itemId, part);
          return { turnActive };
        }
        default:
          // Unknown / Phase 0+ item types: skip silently
          return { turnActive };
      }
    }
    default:
      // Other Codex methods (item/started, thread/*, account/*, mcpServer/*,
      // tokenUsage, etc.) are not surfaced in Phase 0.
      return { turnActive };
  }
}

/**
 * Map a Codex tool-shaped `ThreadItem` (from `item/started` or `item/completed`)
 * to a `DynamicToolUIPart`. Returns `null` for non-tool items so callers can
 * skip without re-checking the type.
 */
function mapCodexToolItem(
  item: Record<string, unknown>,
  itemId: string,
  completed: boolean,
): DynamicToolUIPart | null {
  const itemType = String(item.type ?? '');
  switch (itemType) {
    case 'commandExecution':
      return makeCodexToolPart({
        toolName: 'Bash',
        toolCallId: itemId,
        input: { command: item.command, cwd: item.cwd },
        status: String(item.status ?? 'inProgress'),
        output: item.aggregatedOutput,
      });
    case 'fileChange': {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      return makeCodexToolPart({
        toolName: 'Edit',
        toolCallId: itemId,
        input: { changes },
        status: String(item.status ?? 'inProgress'),
        output: `${changes.length} file change${changes.length === 1 ? '' : 's'}`,
      });
    }
    case 'mcpToolCall': {
      const server = String(item.server ?? '');
      const tool = String(item.tool ?? '');
      const error = item.error as Record<string, unknown> | string | null;
      // Codex may report errors as plain strings (`"timeout"`) or as
      // structured objects (`{ message: '...' }`). Coerce both without
      // wrapping bare strings in JSON quotes.
      let errorText: string | undefined;
      if (error) {
        if (typeof error === 'string') {
          errorText = error;
        } else {
          const msg = (error as Record<string, unknown>).message;
          errorText = typeof msg === 'string' ? msg : JSON.stringify(error);
        }
      }
      return makeCodexToolPart({
        toolName: `mcp__${server}__${tool}`,
        toolCallId: itemId,
        input: item.arguments,
        status: error ? 'failed' : String(item.status ?? 'inProgress'),
        output: item.result,
        errorText,
      });
    }
    case 'webSearch':
      return makeCodexToolPart({
        toolName: 'WebSearch',
        toolCallId: itemId,
        input: { query: item.query },
        // webSearch ThreadItem has no `status` field, and `query` is present in
        // both item/started and item/completed payloads — so we rely on the
        // event boundary the caller passes in.
        status: completed ? 'completed' : 'inProgress',
        output: '',
      });
    case 'dynamicToolCall': {
      // User-installed / function tools surface here. Concatenate text content
      // items into a single output blob; image items are placeholdered until
      // the UI gains attachment rendering.
      const contentItems = Array.isArray(item.contentItems)
        ? (item.contentItems as Array<Record<string, unknown>>)
        : [];
      const output = contentItems
        .map((c) =>
          c.type === 'inputText'
            ? String(c.text ?? '')
            : c.type === 'inputImage'
              ? '[image]'
              : '',
        )
        .filter(Boolean)
        .join('');
      const success = item.success;
      const status =
        success === false
          ? 'failed'
          : (String(item.status ?? '') as
              | 'inProgress'
              | 'completed'
              | 'failed');
      return makeCodexToolPart({
        toolName: String(item.tool ?? 'dynamic'),
        toolCallId: itemId,
        input: item.arguments,
        status,
        output,
      });
    }
    default:
      return null;
  }
}

/**
 * Insert or replace a tool-call UIMessage keyed by `codex-${itemId}` so the
 * same message updates from `item/started` (input-available) → `item/completed`
 * (output-available / output-error / output-denied).
 */
function upsertCodexToolMessage(
  // biome-ignore lint/suspicious/noExplicitAny: UIMessage parts union is complex
  messages: any[],
  itemId: string,
  part: DynamicToolUIPart,
): void {
  const id = `codex-${itemId}`;
  const idx = messages.findIndex((m) => m.id === id);
  const msg = { id, role: 'assistant', parts: [part] };
  if (idx === -1) {
    messages.push(msg);
  } else {
    messages[idx] = msg;
  }
}

/**
 * Insert or update an in-flight Codex agent-message UIMessage. Multiple
 * agentMessage items per turn each get their own bubble (keyed by itemId).
 */
function upsertCodexAgentMessage(
  // biome-ignore lint/suspicious/noExplicitAny: UIMessage parts union is complex
  messages: any[],
  itemId: string,
  text: string,
  state: 'streaming' | 'done' = 'streaming',
): void {
  if (!text) return;
  const id = `codex-${itemId}`;
  const idx = messages.findIndex((m) => m.id === id);
  const part = { type: 'text', text, state };
  if (idx === -1) {
    messages.push({ id, role: 'assistant', parts: [part] });
  } else {
    messages[idx] = { ...messages[idx], parts: [part] };
  }
}

interface CodexToolPartInput {
  toolName: string;
  toolCallId: string;
  input: unknown;
  status: string;
  output?: unknown;
  errorText?: string;
}

/** Map a Codex item status to a `DynamicToolUIPart`. */
function makeCodexToolPart(args: CodexToolPartInput): DynamicToolUIPart {
  const { toolName, toolCallId, input, status, output, errorText } = args;
  // biome-ignore lint/suspicious/noExplicitAny: input is intentionally unknown
  const safeInput = (input ?? {}) as any;

  if (status === 'failed') {
    return {
      type: 'dynamic-tool',
      toolName,
      toolCallId,
      state: 'output-error',
      input: safeInput,
      errorText: errorText ?? String(output ?? 'Tool call failed'),
    };
  }
  if (status === 'declined') {
    return {
      type: 'dynamic-tool',
      toolName,
      toolCallId,
      state: 'output-denied',
      input: safeInput,
      approval: { id: toolCallId, approved: false },
    };
  }
  if (status === 'completed') {
    return {
      type: 'dynamic-tool',
      toolName,
      toolCallId,
      state: 'output-available',
      input: safeInput,
      output: output ?? '',
    };
  }
  // 'inProgress' or unknown — show input only
  return {
    type: 'dynamic-tool',
    toolName,
    toolCallId,
    state: 'input-available',
    input: safeInput,
  };
}

/**
 * Extracts the most recent prompt suggestion from the SDK event stream.
 *
 * Returns the `suggestion` field from the last `prompt_suggestion` event,
 * but only if it appears after the final `user` or `assistant` event in the
 * stream. Both user and assistant events clear the suggestion. Empty or
 * whitespace-only suggestions are treated as noise (not clear signals) and
 * skipped — the SDK clears suggestions via the next user/assistant turn.
 *
 * Note: `prompt_suggestion` is not yet part of the official `SDKMessage` union
 * in `@anthropic-ai/claude-agent-sdk` types. The runtime events are emitted as
 * plain objects so the type check works, but TypeScript may flag `.suggestion`
 * access if the SDK types are tightened. Track for inclusion upstream.
 */
export function extractPromptSuggestion(events: SDKMessage[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    // biome-ignore lint/style/noNonNullAssertion: index is within bounds (loop condition guarantees i >= 0 && i < events.length)
    const event = events[i]!;
    if (event.type === 'user' || event.type === 'assistant') return null;
    if (event.type === 'prompt_suggestion') {
      const suggestion = (event as { suggestion?: string }).suggestion;
      if (suggestion?.trim()) return suggestion.trim();
    }
  }
  return null;
}
