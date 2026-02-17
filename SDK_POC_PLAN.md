# SDK Proof of Concept Plan

Goal: validate the Claude Agent SDK works for Holophyte's needs before committing to the full migration. By the end, you should have hands-on experience with the event model, permission handling, session resume, and model selection — all running under Bun.

## Setup

```bash
bun add @anthropic-ai/claude-agent-sdk
```

Create a test script at `src/claude/sdk-poc.ts`. Run it with `bun run src/claude/sdk-poc.ts`.

## Step 1: Basic Query + Event Streaming

Spawn a simple session and log every event type you receive.

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

const response = query({
  prompt: 'Read the file CLAUDE.md and summarize it in 2 sentences.',
  options: {
    cwd: process.cwd(),
    executable: 'bun',
    model: 'claude-sonnet-4-5-20250929',
    settingSources: ['project'],
    includePartialMessages: true,
  },
});

for await (const message of response) {
  console.log(`[${message.type}]`, message.subtype ?? '');

  if (message.type === 'system' && message.subtype === 'init') {
    console.log('  session_id:', message.session_id);
    console.log('  model:', message.model);
    console.log('  tools:', message.tools);
  }

  if (message.type === 'assistant') {
    console.log('  content:', JSON.stringify(message.message.content).slice(0, 200));
  }

  if (message.type === 'result') {
    console.log('  result:', message.result.slice(0, 200));
    console.log('  cost:', message.total_cost_usd);
    console.log('  turns:', message.num_turns);
    console.log('  duration:', message.duration_ms, 'ms');
    console.log('  usage:', JSON.stringify(message.usage));
  }
}
```

**What to verify:**
- [ ] Script runs without errors under Bun
- [ ] You see a `system/init` event with session_id, tools list, model name
- [ ] You see `assistant` events with Claude's response content
- [ ] You see `stream_event` events (partial streaming tokens)
- [ ] You see a `result` event with cost, usage, and duration
- [ ] The `tools` list in the init event matches what Claude Code normally has

## Step 2: canUseTool — Permission Interception

This is the critical feature. Test that you can intercept tool calls and approve/deny them programmatically.

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

const response = query({
  prompt: 'Create a file called /tmp/holophyte-sdk-test.txt with the content "hello from sdk"',
  options: {
    cwd: process.cwd(),
    executable: 'bun',
    model: 'claude-sonnet-4-5-20250929',
    permissionMode: 'default',
    canUseTool: async (toolName, input, { signal }) => {
      console.log('\n=== PERMISSION REQUEST ===');
      console.log('  tool:', toolName);
      console.log('  input:', JSON.stringify(input).slice(0, 300));

      // Auto-approve reads, prompt for writes
      if (['Read', 'Glob', 'Grep'].includes(toolName)) {
        console.log('  -> AUTO-APPROVED (read-only tool)');
        return { behavior: 'allow', updatedInput: input };
      }

      // Simulate user clicking "Approve" after a delay
      console.log('  -> PROMPTING USER (write tool)...');
      await new Promise((r) => setTimeout(r, 1000)); // simulate UI delay
      console.log('  -> APPROVED by user');
      return { behavior: 'allow', updatedInput: input };
    },
  },
});

for await (const message of response) {
  if (message.type === 'result') {
    console.log('\nDone:', message.result.slice(0, 200));
  }
}
```

**What to verify:**
- [ ] `canUseTool` gets called for each tool Claude wants to use
- [ ] You see the tool name and input parameters
- [ ] Read/Glob/Grep tools are auto-approved
- [ ] Write/Edit/Bash tools trigger the "prompting" branch
- [ ] The file is actually created at `/tmp/holophyte-sdk-test.txt`
- [ ] Returning `{ behavior: 'deny', message: '...' }` actually blocks the tool

**Then test denial:**
Change the write branch to return `{ behavior: 'deny', message: 'User rejected this action' }` and verify Claude gets the denial message and adapts.

## Step 3: Session Resume

Test that you can stop a session and pick it up later with full context.

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

// --- Turn 1: Start a session ---
let sessionId: string;

const turn1 = query({
  prompt: 'Remember this number: 42. Tell me you have remembered it.',
  options: {
    cwd: process.cwd(),
    executable: 'bun',
    model: 'claude-sonnet-4-5-20250929',
  },
});

for await (const message of turn1) {
  if (message.type === 'system' && message.subtype === 'init') {
    sessionId = message.session_id;
    console.log('Session started:', sessionId);
  }
  if (message.type === 'result') {
    console.log('Turn 1 result:', message.result.slice(0, 200));
  }
}

// --- Turn 2: Resume and test context ---
console.log('\nResuming session:', sessionId!);

const turn2 = query({
  prompt: 'What number did I ask you to remember?',
  options: {
    cwd: process.cwd(),
    executable: 'bun',
    model: 'claude-sonnet-4-5-20250929',
    resume: sessionId!,
  },
});

for await (const message of turn2) {
  if (message.type === 'result') {
    console.log('Turn 2 result:', message.result.slice(0, 200));
    // Should mention "42"
  }
}
```

**What to verify:**
- [ ] Turn 1 completes and you capture the session_id
- [ ] Turn 2 resumes successfully with the same session_id
- [ ] Claude remembers "42" in turn 2 (context preserved)
- [ ] No errors about session not found

## Step 4: Model Selection

Test spawning sessions with different models and switching mid-session.

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

const models = [
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5-20251001',
];

for (const model of models) {
  console.log(`\n--- Testing model: ${model} ---`);
  const start = Date.now();

  const response = query({
    prompt: 'What model are you? Reply in one sentence.',
    options: {
      cwd: process.cwd(),
      executable: 'bun',
      model,
    },
  });

  for await (const message of response) {
    if (message.type === 'system' && message.subtype === 'init') {
      console.log('  confirmed model:', message.model);
    }
    if (message.type === 'result') {
      console.log('  result:', message.result.slice(0, 200));
      console.log('  cost:', message.total_cost_usd);
      console.log('  time:', Date.now() - start, 'ms');
    }
  }
}
```

**What to verify:**
- [ ] Each model spawns successfully
- [ ] `init.model` confirms the requested model
- [ ] Haiku is noticeably faster than Sonnet
- [ ] Cost differs between models
- [ ] Opus works too (test separately — `claude-opus-4-6`, may be slower)

**Then test setModel():**
```typescript
const response = query({ prompt: '...', options: { model: 'claude-haiku-4-5-20251001' } });
// After first event:
await response.setModel('claude-sonnet-4-5-20250929');
// Verify subsequent events use the new model
```

## Step 5: AbortController

Test clean cancellation of a long-running session.

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

const controller = new AbortController();

const response = query({
  prompt: 'Write a detailed 2000-word essay about the history of computing.',
  options: {
    cwd: process.cwd(),
    executable: 'bun',
    model: 'claude-sonnet-4-5-20250929',
    abortController: controller,
  },
});

// Abort after 5 seconds
setTimeout(() => {
  console.log('\n--- ABORTING ---');
  controller.abort();
}, 5000);

try {
  for await (const message of response) {
    if (message.type === 'stream_event') {
      process.stdout.write('.'); // show progress
    }
  }
} catch (err) {
  console.log('\nCaught:', (err as Error).name, (err as Error).message);
}
```

**What to verify:**
- [ ] Session starts and you see streaming dots
- [ ] After 5s, abort fires and the loop exits
- [ ] Error is an AbortError (or similar), not a crash
- [ ] No orphaned processes left running (`ps aux | grep claude`)

## Step 6: WebSocket Integration Sketch

Don't build the full thing — just prove the event-to-WebSocket pipeline works.

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

// Simulate what the server would do: serialize events to JSON for a WebSocket client
const response = query({
  prompt: 'Read package.json and tell me the project name.',
  options: {
    cwd: process.cwd(),
    executable: 'bun',
    model: 'claude-haiku-4-5-20251001',
    includePartialMessages: true,
    canUseTool: async (toolName, input) => {
      // This is the event we'd send to the frontend as a permission prompt
      const wsMessage = JSON.stringify({
        type: 'permission_request',
        tool: toolName,
        input,
        timestamp: Date.now(),
      });
      console.log('WS →', wsMessage.slice(0, 200));
      return { behavior: 'allow', updatedInput: input };
    },
  },
});

for await (const message of response) {
  // This is the event we'd send to the frontend via WebSocket
  const wsMessage = JSON.stringify({
    type: message.type,
    subtype: (message as any).subtype,
    sessionId: (message as any).session_id,
    timestamp: Date.now(),
    // Include relevant data based on type
    ...(message.type === 'assistant' && { content: message.message.content }),
    ...(message.type === 'result' && {
      result: message.result,
      cost: message.total_cost_usd,
      usage: message.usage,
    }),
  });
  console.log('WS →', wsMessage.slice(0, 300));
}
```

**What to verify:**
- [ ] Every event can be JSON.stringify'd without errors
- [ ] Permission requests serialize cleanly with tool name + input
- [ ] The data is rich enough to render a useful UI (messages have content, results have cost)
- [ ] No circular references or unserializable values in events

## Done Checklist

After completing all steps, you should be confident about:

- [ ] **Bun compatibility** — the SDK runs without issues under Bun
- [ ] **Event model** — you understand the full lifecycle: system/init → assistant → stream_event → result
- [ ] **canUseTool** — you can intercept, inspect, approve, and deny tool calls programmatically
- [ ] **Session resume** — you can stop and continue sessions with context preserved
- [ ] **Model selection** — you can pick models per session and switch mid-session
- [ ] **Abort** — you can cleanly cancel sessions without orphaned processes
- [ ] **Serialization** — events can be serialized to JSON for WebSocket transport
- [ ] **Cost tracking** — result events include usable cost and token data

If anything doesn't work as expected, document it — those are the constraints we need to design around for the full migration.

## Cleanup

```bash
rm /tmp/holophyte-sdk-test.txt
rm src/claude/sdk-poc.ts  # or keep as reference
```

Update the Notion board: mark "SDK proof of concept (Claude Agent SDK)" as Done once complete.
