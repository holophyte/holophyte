import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef } from 'react';
import type { SessionExitEvent, WsServerMessage } from '@/claude/manager';
import { ansi } from '@/constants';
import '@xterm/xterm/css/xterm.css';

interface UseTerminalOptions {
  sessionId: string | null;
  onSessionExit?: (event: SessionExitEvent) => void;
}

function tryParseWsMessage(data: string): WsServerMessage | null {
  try {
    return JSON.parse(data) as WsServerMessage;
  } catch {
    return null;
  }
}

export function useTerminal({ sessionId, onSessionExit }: UseTerminalOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onSessionExitRef = useRef(onSessionExit);
  onSessionExitRef.current = onSessionExit;

  useEffect(() => {
    if (!sessionId || !containerRef.current) return;

    const container = containerRef.current;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'SF Mono', Menlo, Monaco, 'Courier New', monospace",
      theme: {
        background: '#000000',
        foreground: '#cccccc',
      },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Fit only when container has dimensions
    const safeFit = () => {
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        try {
          fitAddon.fit();
        } catch {
          // ignore fit errors during layout transitions
        }
      }
    };

    // Defer initial fit to next frame so layout is settled
    requestAnimationFrame(safeFit);

    // Connect WebSocket — Phase 1 path (replaced by SessionPanel in Phase 2)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/ws/session/${sessionId}`,
    );

    ws.onopen = () => {
      terminal.writeln(ansi.green('Connected to session.'));
      safeFit();
    };

    ws.onmessage = (rawEvent) => {
      const msg = tryParseWsMessage(rawEvent.data);
      if (!msg) return;

      if (msg.type === 'status') {
        const color = msg.status === 'completed' ? ansi.green : ansi.red;
        terminal.writeln(`\r\n${color(`Session ${msg.status}.`)}`);
        if (msg.status !== 'running') {
          onSessionExitRef.current?.({
            type: 'session_exit',
            status: msg.status,
          });
        }
      } else if (msg.type === 'error') {
        terminal.writeln(`\r\n${ansi.red(`Error: ${msg.message}`)}`);
      } else if (msg.type === 'permission') {
        terminal.writeln(`\r\n[Waiting for approval: ${msg.tool}]`);
      } else if (msg.type === 'event') {
        // Extract text from assistant messages for minimal display
        const ev = msg.event as Record<string, unknown>;
        if (ev.type === 'assistant') {
          const content = (ev as { message?: { content?: unknown[] } }).message
            ?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              const b = block as Record<string, unknown>;
              if (b.type === 'text' && typeof b.text === 'string') {
                terminal.write(b.text);
              }
            }
          }
        }
      }
    };

    ws.onclose = () => {
      terminal.writeln(`\r\n${ansi.red('Session disconnected.')}`);
    };

    terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    wsRef.current = ws;

    // Handle resize (resize API removed in Phase 1 — Phase 2 replaces this hook)
    const resizeObserver = new ResizeObserver(() => {
      safeFit();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      ws.close();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
    };
  }, [sessionId]);

  return containerRef;
}
