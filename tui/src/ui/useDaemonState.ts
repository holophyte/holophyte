/**
 * Shared daemon-subscription hook for the TUI and the per-window sidebar.
 * Owns the subscribe-with-retry loop (reconnect every second after the
 * connection drops) and a 1s tick so elapsed-in-state displays stay current.
 */

import { useEffect, useRef, useState } from 'react';
import type { StatePush } from '../protocol';
import type { Gateway } from './gateway';
import type { DaemonStatus } from './StatusBar';

const RETRY_MS = 1000;

export function useDaemonState(
  gateway: Gateway,
  onState?: (s: StatePush) => void,
): { push: StatePush | null; daemon: DaemonStatus; now: number } {
  const [push, setPush] = useState<StatePush | null>(null);
  const [daemon, setDaemon] = useState<DaemonStatus>('connecting');
  const [now, setNow] = useState(() => Date.now());

  // Route onState through a ref so a fresh callback identity each render never
  // tears down and re-subscribes the connection — only the gateway should.
  const onStateRef = useRef(onState);
  useEffect(() => {
    onStateRef.current = onState;
  });

  // Subscription lifecycle — external system: subscribe on mount, retry every
  // second after the connection drops until the daemon is back.
  useEffect(() => {
    let disposed = false;
    let sub: { close(): void } | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      if (disposed) return;
      try {
        sub = gateway.subscribe({
          onState: (s) => {
            setPush(s);
            setDaemon('up');
            onStateRef.current?.(s);
          },
          onClose: () => {
            sub = null;
            setDaemon('down');
            retry = setTimeout(connect, RETRY_MS);
          },
        });
      } catch {
        setDaemon('down');
        retry = setTimeout(connect, RETRY_MS);
      }
    };
    connect();
    return () => {
      disposed = true;
      if (retry !== null) clearTimeout(retry);
      sub?.close();
    };
  }, [gateway]);

  // 1s tick so elapsed-in-state displays stay current.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return { push, daemon, now };
}
