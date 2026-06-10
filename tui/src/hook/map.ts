/**
 * Pure mapping from harness-native hook payloads (stdin JSON) to holo
 * actions. All mapping decisions live here so they're unit-testable;
 * src/hook/main.ts stays a thin I/O shell.
 *
 * Schemas per docs/hooks-research.md (ground truth). Defensive throughout:
 * wrong-typed fields fall back to something sensible, never throw.
 */

import type { SessionEvent } from '../protocol';

export type HookAction =
  | { type: 'event'; event: SessionEvent }
  | { type: 'permission'; tool: string; input: unknown }
  | { type: 'ignore' };

const QUESTION_FALLBACK = 'agent asked a question';

/** tool_input.questions[0].question, defensively. */
function questionText(toolInput: unknown): string {
  if (toolInput !== null && typeof toolInput === 'object') {
    const questions = (toolInput as { questions?: unknown }).questions;
    if (Array.isArray(questions)) {
      const first: unknown = questions[0];
      if (first !== null && typeof first === 'object') {
        const q = (first as { question?: unknown }).question;
        if (typeof q === 'string' && q.trim() !== '') return q;
      }
    }
  }
  return QUESTION_FALLBACK;
}

export function mapHook(
  harness: 'claude' | 'codex',
  payload: Record<string, unknown>,
): HookAction {
  switch (payload.hook_event_name) {
    case 'SessionStart':
      return { type: 'event', event: { kind: 'ready' } };

    case 'UserPromptSubmit':
      return { type: 'event', event: { kind: 'prompt' } };

    case 'PreToolUse': {
      if (harness === 'claude' && payload.tool_name === 'AskUserQuestion') {
        return {
          type: 'event',
          event: { kind: 'question', text: questionText(payload.tool_input) },
        };
      }
      return { type: 'event', event: { kind: 'tool' } };
    }

    case 'Notification': {
      // Claude-only; codex has no Notification hook (research doc).
      if (harness !== 'claude') return { type: 'ignore' };
      const notifType = payload.notification_type;
      if (notifType !== 'permission_prompt' && notifType !== 'idle_prompt') {
        return { type: 'ignore' };
      }
      const message = payload.message;
      const reason =
        typeof message === 'string' && message.trim() !== ''
          ? message
          : notifType;
      return { type: 'event', event: { kind: 'notification', reason } };
    }

    case 'Stop': {
      if (harness === 'codex') {
        // Codex carries the last message directly on the payload.
        const last = payload.last_assistant_message;
        if (typeof last === 'string' && last !== '') {
          return { type: 'event', event: { kind: 'stop', lastMessage: last } };
        }
      }
      // Claude's lastMessage is enriched from the transcript by main.ts —
      // map.ts stays pure (no filesystem access).
      return { type: 'event', event: { kind: 'stop' } };
    }

    case 'SessionEnd': {
      // Claude-only; codex has no SessionEnd hook (research doc).
      if (harness !== 'claude') return { type: 'ignore' };
      const reason = payload.reason;
      return {
        type: 'event',
        event:
          typeof reason === 'string'
            ? { kind: 'exit', reason }
            : { kind: 'exit' },
      };
    }

    case 'PermissionRequest':
      return {
        type: 'permission',
        tool: String(payload.tool_name),
        input: payload.tool_input,
      };

    default:
      return { type: 'ignore' };
  }
}
