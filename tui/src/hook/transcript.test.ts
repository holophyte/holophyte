// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lastAssistantMessage } from './transcript';

function assistantLine(...texts: string[]): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: texts.map((text) => ({ type: 'text', text })),
    },
  });
}

function userLine(text: string): string {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
  });
}

describe('lastAssistantMessage', () => {
  let dir: string;
  let counter = 0;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'holo-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function fixture(content: string): string {
    const path = join(dir, `transcript-${counter++}.jsonl`);
    writeFileSync(path, content);
    return path;
  }

  it('returns the last assistant message from a normal transcript', () => {
    const path = fixture(
      [
        userLine('do the thing'),
        assistantLine('working on it'),
        userLine('and another'),
        assistantLine('all done, tests pass'),
      ].join('\n') + '\n',
    );
    expect(lastAssistantMessage(path)).toBe('all done, tests pass');
  });

  it('joins multiple text blocks with newlines, skipping empty ones', () => {
    const path = fixture(
      assistantLine('first block', '', 'second block') + '\n',
    );
    expect(lastAssistantMessage(path)).toBe('first block\nsecond block');
  });

  it('finds the assistant message past trailing non-assistant lines', () => {
    const path = fixture(
      [
        assistantLine('the real answer'),
        userLine('a trailing user line'),
        JSON.stringify({ type: 'system', subtype: 'turn_end' }),
        JSON.stringify({ type: 'summary', summary: 'whatever' }),
      ].join('\n') + '\n',
    );
    expect(lastAssistantMessage(path)).toBe('the real answer');
  });

  it('skips assistant entries with no text blocks (tool_use only)', () => {
    const toolUseLine = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: {} }],
      },
    });
    const path = fixture(
      [assistantLine('text before tool use'), toolUseLine].join('\n') + '\n',
    );
    expect(lastAssistantMessage(path)).toBe('text before tool use');
  });

  it('reads only the last maxBytes of a large file', () => {
    // Assistant message lives at the head; filler pushes it outside the
    // 512-byte tail window → not found.
    const filler = Array.from({ length: 50 }, (_, i) =>
      JSON.stringify({ type: 'system', seq: i, pad: 'x'.repeat(40) }),
    );
    const headOnly = fixture(
      [assistantLine('buried in the head'), ...filler].join('\n') + '\n',
    );
    expect(lastAssistantMessage(headOnly, 512)).toBeUndefined();

    // Same file with another assistant message near the end → found, and the
    // torn first line inside the window is skipped without error.
    const withTail = fixture(
      [
        assistantLine('buried in the head'),
        ...filler,
        assistantLine('visible in the tail'),
      ].join('\n') + '\n',
    );
    expect(lastAssistantMessage(withTail, 512)).toBe('visible in the tail');
  });

  it('skips corrupt lines while scanning backwards', () => {
    const path = fixture(
      [
        assistantLine('good message'),
        '{"type":"assistant","message":{"content":[{"type":"text","te', // torn
        'not json at all }{',
      ].join('\n') + '\n',
    );
    expect(lastAssistantMessage(path)).toBe('good message');
  });

  it('returns undefined for a missing file', () => {
    expect(lastAssistantMessage(join(dir, 'nope.jsonl'))).toBeUndefined();
  });

  it('returns undefined for an empty file', () => {
    expect(lastAssistantMessage(fixture(''))).toBeUndefined();
  });

  it('returns undefined when no assistant lines exist', () => {
    const path = fixture(
      [userLine('hello'), JSON.stringify({ type: 'system' })].join('\n') + '\n',
    );
    expect(lastAssistantMessage(path)).toBeUndefined();
  });

  it('trims surrounding whitespace', () => {
    const path = fixture(assistantLine('  padded  ') + '\n');
    expect(lastAssistantMessage(path)).toBe('padded');
  });

  it('caps the message at 2000 chars with an ellipsis', () => {
    const long = 'a'.repeat(3000);
    const path = fixture(assistantLine(long) + '\n');
    const result = lastAssistantMessage(path);
    expect(result).toBe(`${'a'.repeat(2000)}…`);
    expect(result?.length).toBe(2001);
  });

  it('handles malformed message shapes without throwing', () => {
    const path = fixture(
      [
        JSON.stringify({ type: 'assistant', message: null }),
        JSON.stringify({ type: 'assistant', message: { content: 'string' } }),
        JSON.stringify({ type: 'assistant' }),
        JSON.stringify({ type: 'assistant', message: { content: [null, 42] } }),
      ].join('\n') + '\n',
    );
    expect(lastAssistantMessage(path)).toBeUndefined();
  });
});
