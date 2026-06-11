/**
 * Claude transcript tail-reader. Claude's Stop hook does NOT carry the last
 * assistant message (docs/hooks-research.md) — we read it from the tail of
 * the JSONL transcript at `transcript_path` instead.
 */

import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

const MAX_MESSAGE_CHARS = 2000;

/**
 * Last assistant message text from a Claude JSONL transcript. Reads only the
 * final `maxBytes` of the file so huge transcripts stay cheap. Returns
 * undefined on any error or when no assistant text is found — never throws.
 */
export function lastAssistantMessage(
  transcriptPath: string,
  maxBytes = 262144,
): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(transcriptPath, 'r');
    const { size } = fstatSync(fd);
    const readBytes = Math.min(size, maxBytes);
    if (readBytes <= 0) return undefined;
    const position = size - readBytes;
    const buf = Buffer.alloc(readBytes);
    let offset = 0;
    while (offset < readBytes) {
      const n = readSync(
        fd,
        buf,
        offset,
        readBytes - offset,
        position + offset,
      );
      if (n <= 0) break;
      offset += n;
    }
    // When we start mid-file the first line is likely torn — its JSON.parse
    // fails and the scan just skips it.
    const lines = buf.toString('utf8', 0, offset).split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]?.trim();
      if (!line) continue;
      const text = assistantText(line);
      if (text !== undefined) return text;
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // already closed / invalid — nothing to do
      }
    }
  }
}

/** Extract joined text blocks from one transcript line, if it's an assistant message with text. */
function assistantText(line: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object') return undefined;
  const record = parsed as { type?: unknown; message?: unknown };
  if (record.type !== 'assistant') return undefined;
  const message = record.message;
  if (message === null || typeof message !== 'object') return undefined;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;

  const texts: string[] = [];
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue;
    const b = block as { type?: unknown; text?: unknown };
    if (b.type === 'text' && typeof b.text === 'string' && b.text !== '') {
      texts.push(b.text);
    }
  }
  const joined = texts.join('\n').trim();
  // Tool-use-only assistant entries have no text — keep scanning earlier lines.
  if (joined === '') return undefined;
  return joined.length > MAX_MESSAGE_CHARS
    ? `${joined.slice(0, MAX_MESSAGE_CHARS)}…`
    : joined;
}
