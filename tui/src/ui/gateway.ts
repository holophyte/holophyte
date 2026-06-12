/**
 * Daemon access seam for the TUI — App talks to this interface so tests can
 * inject a FakeGateway instead of the real Unix-socket client.
 */

import { request, subscribe } from '../client';
import type { Request, Response, StatePush } from '../protocol';

export interface Gateway {
  subscribe(handlers: {
    onState: (s: StatePush) => void;
    onClose?: () => void;
  }): { close(): void };
  request(req: Request): Promise<Response>;
}

export const liveGateway: Gateway = {
  subscribe: (handlers) => subscribe(handlers),
  request: (req) => request(req),
};
