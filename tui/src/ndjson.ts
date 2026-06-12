import type { Socket } from 'node:net';

/**
 * Incrementally parse newline-delimited JSON from a socket. Malformed lines
 * are dropped — the protocol is local and trusted, and a torn line on
 * disconnect is normal.
 */
export function onJsonLines(
  socket: Socket,
  onValue: (value: unknown) => void,
): void {
  // setEncoding routes reads through string_decoder, which carries multi-byte
  // UTF-8 sequences split across chunk boundaries instead of corrupting them
  socket.setEncoding('utf8');
  let buf = '';
  socket.on('data', (chunk: string) => {
    buf += chunk;
    let idx = buf.indexOf('\n');
    while (idx !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.trim() !== '') {
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          value = undefined; // drop malformed line
        }
        if (value !== undefined) onValue(value);
      }
      idx = buf.indexOf('\n');
    }
  });
}

export function writeJsonLine(socket: Socket, value: unknown): void {
  socket.write(`${JSON.stringify(value)}\n`);
}
