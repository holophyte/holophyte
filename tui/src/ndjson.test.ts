import type { Socket } from 'node:net';
import { PassThrough } from 'node:stream';
import { onJsonLines } from './ndjson';

function collect(stream: PassThrough): unknown[] {
  const values: unknown[] = [];
  onJsonLines(stream as unknown as Socket, (value) => values.push(value));
  return values;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('onJsonLines', () => {
  it('parses multiple lines from one chunk and buffers partial lines', async () => {
    const stream = new PassThrough();
    const values = collect(stream);
    stream.write('{"a":1}\n{"b":2}\n{"c"');
    stream.write(':3}\n');
    await flush();
    expect(values).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it('drops malformed and blank lines', async () => {
    const stream = new PassThrough();
    const values = collect(stream);
    stream.write('not json\n\n{"ok":true}\n');
    await flush();
    expect(values).toEqual([{ ok: true }]);
  });

  it('reassembles a multi-byte UTF-8 char split across chunks', async () => {
    const stream = new PassThrough();
    const values = collect(stream);
    const line = Buffer.from(`${JSON.stringify({ text: '日本語' })}\n`, 'utf8');
    // split inside 日 (3 bytes starting after the ASCII prefix)
    const splitAt = Buffer.byteLength('{"text":"') + 1;
    stream.write(line.subarray(0, splitAt));
    await flush();
    stream.write(line.subarray(splitAt));
    await flush();
    expect(values).toEqual([{ text: '日本語' }]);
    expect(JSON.stringify(values[0])).not.toContain('�');
  });
});
