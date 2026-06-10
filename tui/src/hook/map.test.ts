import type { HookAction } from './map';
import { mapHook } from './map';

type Harness = 'claude' | 'codex';

describe('mapHook', () => {
  describe('table-driven mapping rules', () => {
    const cases: Array<{
      name: string;
      harness: Harness;
      payload: Record<string, unknown>;
      expected: HookAction;
    }> = [
      // SessionStart → ready
      {
        name: 'claude SessionStart → ready',
        harness: 'claude',
        payload: { hook_event_name: 'SessionStart', source: 'startup' },
        expected: { type: 'event', event: { kind: 'ready' } },
      },
      {
        name: 'codex SessionStart → ready',
        harness: 'codex',
        payload: { hook_event_name: 'SessionStart' },
        expected: { type: 'event', event: { kind: 'ready' } },
      },

      // UserPromptSubmit → prompt
      {
        name: 'claude UserPromptSubmit → prompt',
        harness: 'claude',
        payload: { hook_event_name: 'UserPromptSubmit', prompt: 'do stuff' },
        expected: { type: 'event', event: { kind: 'prompt' } },
      },
      {
        name: 'codex UserPromptSubmit → prompt',
        harness: 'codex',
        payload: { hook_event_name: 'UserPromptSubmit', prompt: 'go' },
        expected: { type: 'event', event: { kind: 'prompt' } },
      },

      // PreToolUse → tool (claude AskUserQuestion special-cased separately)
      {
        name: 'claude PreToolUse Bash → tool',
        harness: 'claude',
        payload: {
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_input: { command: 'ls' },
        },
        expected: { type: 'event', event: { kind: 'tool' } },
      },
      {
        name: 'codex PreToolUse → tool',
        harness: 'codex',
        payload: {
          hook_event_name: 'PreToolUse',
          tool_name: 'apply_patch',
          tool_input: {},
        },
        expected: { type: 'event', event: { kind: 'tool' } },
      },
      {
        name: 'codex AskUserQuestion is NOT special-cased → tool',
        harness: 'codex',
        payload: {
          hook_event_name: 'PreToolUse',
          tool_name: 'AskUserQuestion',
          tool_input: { questions: [{ question: 'hm?' }] },
        },
        expected: { type: 'event', event: { kind: 'tool' } },
      },

      // AskUserQuestion → question with extracted text
      {
        name: 'claude AskUserQuestion → question with first question text',
        harness: 'claude',
        payload: {
          hook_event_name: 'PreToolUse',
          tool_name: 'AskUserQuestion',
          tool_input: {
            questions: [
              { question: 'Which naming convention?', header: 'Naming' },
              { question: 'second question ignored' },
            ],
          },
        },
        expected: {
          type: 'event',
          event: { kind: 'question', text: 'Which naming convention?' },
        },
      },
      {
        name: 'AskUserQuestion missing tool_input → fallback text',
        harness: 'claude',
        payload: { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' },
        expected: {
          type: 'event',
          event: { kind: 'question', text: 'agent asked a question' },
        },
      },
      {
        name: 'AskUserQuestion questions not an array → fallback text',
        harness: 'claude',
        payload: {
          hook_event_name: 'PreToolUse',
          tool_name: 'AskUserQuestion',
          tool_input: { questions: 'nope' },
        },
        expected: {
          type: 'event',
          event: { kind: 'question', text: 'agent asked a question' },
        },
      },
      {
        name: 'AskUserQuestion empty questions array → fallback text',
        harness: 'claude',
        payload: {
          hook_event_name: 'PreToolUse',
          tool_name: 'AskUserQuestion',
          tool_input: { questions: [] },
        },
        expected: {
          type: 'event',
          event: { kind: 'question', text: 'agent asked a question' },
        },
      },
      {
        name: 'AskUserQuestion question not a string → fallback text',
        harness: 'claude',
        payload: {
          hook_event_name: 'PreToolUse',
          tool_name: 'AskUserQuestion',
          tool_input: { questions: [{ question: 42 }] },
        },
        expected: {
          type: 'event',
          event: { kind: 'question', text: 'agent asked a question' },
        },
      },
      {
        name: 'AskUserQuestion whitespace-only question → fallback text',
        harness: 'claude',
        payload: {
          hook_event_name: 'PreToolUse',
          tool_name: 'AskUserQuestion',
          tool_input: { questions: [{ question: '   ' }] },
        },
        expected: {
          type: 'event',
          event: { kind: 'question', text: 'agent asked a question' },
        },
      },

      // Notification (claude only, filtered by notification_type)
      {
        name: 'claude Notification permission_prompt → notification',
        harness: 'claude',
        payload: {
          hook_event_name: 'Notification',
          notification_type: 'permission_prompt',
          message: 'Claude needs your permission to use Bash',
        },
        expected: {
          type: 'event',
          event: {
            kind: 'notification',
            reason: 'Claude needs your permission to use Bash',
          },
        },
      },
      {
        name: 'claude Notification idle_prompt → notification',
        harness: 'claude',
        payload: {
          hook_event_name: 'Notification',
          notification_type: 'idle_prompt',
          message: 'Claude is waiting for your input',
        },
        expected: {
          type: 'event',
          event: { kind: 'notification', reason: 'Claude is waiting for your input' },
        },
      },
      {
        name: 'claude Notification auth_success → ignore',
        harness: 'claude',
        payload: {
          hook_event_name: 'Notification',
          notification_type: 'auth_success',
          message: 'logged in',
        },
        expected: { type: 'ignore' },
      },
      {
        name: 'claude Notification missing notification_type → ignore',
        harness: 'claude',
        payload: { hook_event_name: 'Notification', message: 'hello' },
        expected: { type: 'ignore' },
      },
      {
        name: 'claude Notification non-string message → reason falls back to type',
        harness: 'claude',
        payload: {
          hook_event_name: 'Notification',
          notification_type: 'idle_prompt',
          message: 42,
        },
        expected: {
          type: 'event',
          event: { kind: 'notification', reason: 'idle_prompt' },
        },
      },
      {
        name: 'codex Notification → ignore (codex has no Notification hook)',
        harness: 'codex',
        payload: {
          hook_event_name: 'Notification',
          notification_type: 'permission_prompt',
          message: 'x',
        },
        expected: { type: 'ignore' },
      },

      // Stop
      {
        name: 'claude Stop → stop without lastMessage (enriched in main.ts)',
        harness: 'claude',
        payload: {
          hook_event_name: 'Stop',
          transcript_path: '/tmp/t.jsonl',
          effort: 'medium',
        },
        expected: { type: 'event', event: { kind: 'stop' } },
      },
      {
        name: 'codex Stop with last_assistant_message → stop with lastMessage',
        harness: 'codex',
        payload: {
          hook_event_name: 'Stop',
          last_assistant_message: 'All done, tests pass.',
        },
        expected: {
          type: 'event',
          event: { kind: 'stop', lastMessage: 'All done, tests pass.' },
        },
      },
      {
        name: 'codex Stop with null last_assistant_message → stop without lastMessage',
        harness: 'codex',
        payload: { hook_event_name: 'Stop', last_assistant_message: null },
        expected: { type: 'event', event: { kind: 'stop' } },
      },
      {
        name: 'codex Stop with empty last_assistant_message → stop without lastMessage',
        harness: 'codex',
        payload: { hook_event_name: 'Stop', last_assistant_message: '' },
        expected: { type: 'event', event: { kind: 'stop' } },
      },
      {
        name: 'codex Stop with non-string last_assistant_message → stop without lastMessage',
        harness: 'codex',
        payload: { hook_event_name: 'Stop', last_assistant_message: 7 },
        expected: { type: 'event', event: { kind: 'stop' } },
      },

      // SessionEnd (claude only)
      {
        name: 'claude SessionEnd → exit with reason',
        harness: 'claude',
        payload: { hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' },
        expected: {
          type: 'event',
          event: { kind: 'exit', reason: 'prompt_input_exit' },
        },
      },
      {
        name: 'claude SessionEnd non-string reason → exit without reason',
        harness: 'claude',
        payload: { hook_event_name: 'SessionEnd', reason: 123 },
        expected: { type: 'event', event: { kind: 'exit' } },
      },
      {
        name: 'codex SessionEnd → ignore (codex has no SessionEnd hook)',
        harness: 'codex',
        payload: { hook_event_name: 'SessionEnd', reason: 'other' },
        expected: { type: 'ignore' },
      },

      // PermissionRequest
      {
        name: 'claude PermissionRequest → permission with tool + input',
        harness: 'claude',
        payload: {
          hook_event_name: 'PermissionRequest',
          tool_name: 'Bash',
          tool_input: { command: 'rm -rf node_modules' },
          tool_use_id: 'tu_1',
        },
        expected: {
          type: 'permission',
          tool: 'Bash',
          input: { command: 'rm -rf node_modules' },
        },
      },
      {
        name: 'codex PermissionRequest → permission',
        harness: 'codex',
        payload: {
          hook_event_name: 'PermissionRequest',
          tool_name: 'apply_patch',
          tool_input: { patch: '...' },
        },
        expected: {
          type: 'permission',
          tool: 'apply_patch',
          input: { patch: '...' },
        },
      },
      {
        name: 'PermissionRequest missing tool_name → stringified fallback',
        harness: 'claude',
        payload: { hook_event_name: 'PermissionRequest', tool_input: {} },
        expected: { type: 'permission', tool: 'undefined', input: {} },
      },

      // Unknown / missing / malformed
      {
        name: 'unknown hook_event_name → ignore',
        harness: 'claude',
        payload: { hook_event_name: 'PostToolUse', tool_name: 'Bash' },
        expected: { type: 'ignore' },
      },
      {
        name: 'missing hook_event_name → ignore',
        harness: 'claude',
        payload: { session_id: 'abc' },
        expected: { type: 'ignore' },
      },
      {
        name: 'non-string hook_event_name → ignore',
        harness: 'codex',
        payload: { hook_event_name: 42 },
        expected: { type: 'ignore' },
      },
      {
        name: 'empty payload → ignore',
        harness: 'claude',
        payload: {},
        expected: { type: 'ignore' },
      },
    ];

    it.each(cases)('$name', ({ harness, payload, expected }) => {
      expect(mapHook(harness, payload)).toEqual(expected);
    });
  });

  it('never throws on malformed payloads', () => {
    const garbage: Array<Record<string, unknown>> = [
      { hook_event_name: 'PreToolUse', tool_name: null, tool_input: null },
      { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: 'x' },
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'AskUserQuestion',
        tool_input: { questions: [null] },
      },
      { hook_event_name: 'Notification', notification_type: null, message: null },
      { hook_event_name: 'Stop', last_assistant_message: { nested: true } },
      { hook_event_name: 'SessionEnd', reason: { o: 1 } },
      { hook_event_name: 'PermissionRequest' },
    ];
    for (const payload of garbage) {
      expect(() => mapHook('claude', payload)).not.toThrow();
      expect(() => mapHook('codex', payload)).not.toThrow();
    }
  });
});
