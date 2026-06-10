/**
 * holod — the daemon's Unix socket server. Owns the session registry, the
 * spawn flow, held permission connections, and the tmux liveness sweep.
 * Every visible state change is persisted to the state file and broadcast
 * to subscribers as a StatePush.
 */

import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import net from 'node:net';
import { tryRequest } from '../client';
import { onJsonLines, writeJsonLine } from '../ndjson';
import { holoHome, socketPath, statePath } from '../paths';
import type {
  PermissionDecision,
  Request,
  Response,
  StatePush,
} from '../protocol';
import type { Tmux } from '../tmux';
import type {
  HarnessAdapter,
  HarnessId,
  HarnessInfo,
  Session,
  StateSnapshot,
} from '../types';
import { SessionRegistry } from './registry';
import { buildQueue } from './scoring';
import { loadStateFile, saveStateFile } from './state-file';

export interface DaemonOptions {
  tmux: Tmux;
  adapters: Record<HarnessId, HarnessAdapter>;
  /** precomputed configured flags — avoids re-probing binaries per snapshot */
  harnesses: HarnessInfo[];
  /** argv for window 0 (the TUI) when creating the tmux session */
  tuiArgv: string[];
  /** injectable clock for tests, default epoch-ms now */
  now?: () => number;
  sweepIntervalMs?: number;
  /** hard cap on client-requested permission hold time */
  permissionMaxHoldMs?: number;
}

interface Hold {
  socket: net.Socket;
  timer: NodeJS.Timeout;
}

export class Daemon {
  private registry = new SessionRegistry();
  private server: net.Server | null = null;
  private readonly subscribers = new Set<net.Socket>();
  private readonly connections = new Set<net.Socket>();
  /** held permission connections, keyed by sessionId */
  private readonly holds = new Map<string, Hold>();
  private sweepTimer: NodeJS.Timeout | null = null;
  private started = false;
  private stopping: Promise<void> | null = null;
  private readonly now: () => number;
  private readonly sweepIntervalMs: number;
  private readonly permissionMaxHoldMs: number;
  // captured once — HOLO_HOME may change under us (tests swap it per case)
  private readonly socketFile = socketPath();
  private readonly stateFile = statePath();

  constructor(private readonly opts: DaemonOptions) {
    this.now = opts.now ?? Date.now;
    this.sweepIntervalMs = opts.sweepIntervalMs ?? 5000;
    this.permissionMaxHoldMs = opts.permissionMaxHoldMs ?? 90_000;
  }

  async start(): Promise<void> {
    mkdirSync(holoHome(), { recursive: true });
    const persisted = loadStateFile(this.stateFile);
    this.registry = persisted
      ? SessionRegistry.fromJSON(persisted)
      : new SessionRegistry();

    if (existsSync(this.socketFile)) {
      // A live daemon answers ping; a dead one left a stale socket file.
      const live = await tryRequest({ cmd: 'ping' }, { timeoutMs: 250 });
      if (live) throw new Error('holod already running');
      try {
        unlinkSync(this.socketFile);
      } catch {
        // raced away — listen() surfaces any real problem
      }
    }

    const server = net.createServer((socket) => this.onConnection(socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.socketFile, () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.started = true;

    await this.sweepOnce();
    this.sweepTimer = setInterval(() => {
      this.sweepOnce().catch((err) => {
        console.error('holod sweep failed:', err);
      });
    }, this.sweepIntervalMs);
    this.sweepTimer.unref();
  }

  stop(): Promise<void> {
    if (!this.started) return Promise.resolve();
    // idempotent + awaitable from multiple callers (shutdown cmd, signals)
    this.stopping ??= this.doStop();
    return this.stopping;
  }

  private async doStop(): Promise<void> {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    for (const sessionId of [...this.holds.keys()]) {
      this.releaseHold(sessionId, 'timeout');
    }
    for (const subscriber of [...this.subscribers]) subscriber.destroy();
    this.subscribers.clear();
    // end() (not destroy) so queued replies — e.g. the shutdown ack — flush
    for (const socket of [...this.connections]) {
      if (!socket.destroyed) socket.end();
    }
    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    this.persist();
    try {
      unlinkSync(this.socketFile);
    } catch {
      // already gone (node unlinks unix sockets on server close)
    }
  }

  /** Reconcile against live tmux windows + prune old exited sessions. */
  async sweepOnce(): Promise<void> {
    const liveIds = await this.opts.tmux.listWindowIds();
    // run both — pruning must happen even when reconcile changed nothing
    const reconciled = this.registry.reconcile(liveIds, this.now());
    const pruned = this.registry.pruneExited(this.now());
    if (reconciled || pruned) {
      this.persist();
      this.broadcast();
    }
  }

  private onConnection(socket: net.Socket): void {
    this.connections.add(socket);
    socket.on('error', () => {
      // peer reset / write-after-end — close handler does the cleanup
    });
    socket.on('close', () => this.connections.delete(socket));
    onJsonLines(socket, (value) => {
      this.handleLine(socket, value).catch((err) => {
        this.reply(socket, { ok: false, error: String(err) });
      });
    });
  }

  private async handleLine(socket: net.Socket, value: unknown): Promise<void> {
    // local trusted protocol — see ndjson.ts; garbage falls to 'unknown command'
    const req = (value ?? {}) as Request;
    switch (req.cmd) {
      case 'ping':
        this.reply(socket, { ok: true });
        return;
      case 'hook': {
        const changed = this.registry.applyEvent(req.sessionId, req.event, req.ts);
        this.reply(socket, { ok: true }); // always ack fast, even unknown session
        if (changed) {
          this.persist();
          this.broadcast();
        }
        return;
      }
      case 'ls':
        this.reply(socket, { ok: true, state: this.snapshot() });
        return;
      case 'subscribe': {
        this.subscribers.add(socket);
        socket.once('close', () => this.subscribers.delete(socket));
        writeJsonLine(socket, {
          type: 'state',
          ...this.snapshot(),
        } satisfies StatePush);
        return;
      }
      case 'new':
        await this.handleNew(socket, req);
        return;
      case 'next': {
        const queue = buildQueue(this.registry.all(), this.now());
        const top = queue[0];
        const session = top ? this.registry.get(top.sessionId) : undefined;
        if (!session) {
          this.reply(socket, { ok: false, error: 'queue is empty' });
          return;
        }
        await this.opts.tmux.selectWindow(session.tmuxWindow);
        this.reply(socket, { ok: true, session });
        return;
      }
      case 'jump': {
        const session = this.registry.get(req.sessionId);
        if (!session) {
          this.reply(socket, {
            ok: false,
            error: `unknown session: ${req.sessionId}`,
          });
          return;
        }
        await this.opts.tmux.selectWindow(session.tmuxWindow);
        this.reply(socket, { ok: true, session });
        return;
      }
      case 'permission':
        this.handlePermission(socket, req);
        return;
      case 'respondPermission': {
        const decision: PermissionDecision = req.allow ? 'allow' : 'deny';
        if (!this.holds.has(req.sessionId)) {
          this.reply(socket, {
            ok: false,
            error: `no pending permission for ${req.sessionId}`,
          });
          return;
        }
        this.releaseHold(req.sessionId, decision);
        this.persist();
        this.broadcast();
        this.reply(socket, { ok: true });
        return;
      }
      case 'shutdown':
        this.reply(socket, { ok: true });
        void this.stop();
        return;
      default:
        this.reply(socket, { ok: false, error: 'unknown command' });
    }
  }

  private async handleNew(
    socket: net.Socket,
    req: { harness: HarnessId; cwd: string },
  ): Promise<void> {
    const adapter = this.opts.adapters[req.harness] as
      | HarnessAdapter
      | undefined;
    if (!adapter) {
      this.reply(socket, { ok: false, error: `unknown harness: ${req.harness}` });
      return;
    }
    if (!(await adapter.configured())) {
      this.reply(socket, {
        ok: false,
        error: `harness not configured: ${req.harness}`,
      });
      return;
    }
    let session: Session | undefined;
    try {
      await this.opts.tmux.ensureSession(this.opts.tuiArgv);
      session = this.registry.createSession(req.harness, req.cwd, this.now());
      const argv = await adapter.spawnCommand(session);
      const windowId = await this.opts.tmux.newWindow({
        name: session.id,
        cwd: req.cwd,
        argv,
      });
      this.registry.setTmuxWindow(session.id, windowId);
      await this.opts.tmux.selectWindow(windowId); // jump-on-spawn per spec
    } catch (err) {
      if (session) this.removeSession(session.id);
      this.persist(); // keep counters/recentCwds consistent on disk
      this.broadcast();
      this.reply(socket, { ok: false, error: String(err) });
      return;
    }
    this.persist();
    this.broadcast();
    this.reply(socket, {
      ok: true,
      session: this.registry.get(session.id) ?? session,
    });
  }

  private handlePermission(
    socket: net.Socket,
    req: {
      sessionId: string;
      tool: string;
      input: unknown;
      timeoutMs: number;
      ts: number;
    },
  ): void {
    const holdMs = Math.min(req.timeoutMs, this.permissionMaxHoldMs);
    const respondBy = this.now() + holdMs;
    // rare parallel-tool edge: a newer permission replaces the old hold
    if (this.holds.has(req.sessionId)) {
      this.releaseHold(req.sessionId, 'timeout');
    }
    const ok = this.registry.beginPermission(
      req.sessionId,
      req.tool,
      req.input,
      respondBy,
      req.ts,
    );
    if (!ok) {
      // stale/unknown/exited — the hook falls through to the in-pane dialog
      this.reply(socket, { ok: true, decision: 'timeout' });
      return;
    }
    const timer = setTimeout(() => {
      this.releaseHold(req.sessionId, 'timeout');
      this.persist();
      this.broadcast();
    }, holdMs);
    this.holds.set(req.sessionId, { socket, timer });
    socket.once('close', () => {
      const hold = this.holds.get(req.sessionId);
      if (!hold || hold.socket !== socket) return; // resolved or replaced
      this.holds.delete(req.sessionId);
      clearTimeout(hold.timer);
      // agent killed mid-hold — nothing is waiting for a decision anymore
      if (this.registry.resolvePermission(req.sessionId, 'timeout', this.now())) {
        this.persist();
        this.broadcast();
      }
    });
    this.persist();
    this.broadcast();
  }

  /**
   * Resolve a held permission connection: reply with the decision and end
   * the socket. Callers persist + broadcast (skipped during stop()).
   */
  private releaseHold(sessionId: string, decision: PermissionDecision): void {
    const hold = this.holds.get(sessionId);
    if (!hold) return;
    this.holds.delete(sessionId);
    clearTimeout(hold.timer);
    this.registry.resolvePermission(sessionId, decision, this.now());
    this.reply(hold.socket, { ok: true, decision });
  }

  /**
   * Failed-spawn cleanup. The registry has no targeted remove, so mark the
   * session exited and prune with zero grace. May also drop other
   * already-exited sessions slightly early — harmless, they're terminal.
   */
  private removeSession(id: string): void {
    const ts = this.now();
    this.registry.applyEvent(id, { kind: 'exit', reason: 'spawn failed' }, ts);
    this.registry.pruneExited(ts + 1, 0);
  }

  private snapshot(): StateSnapshot {
    const sessions = this.registry.all();
    return {
      sessions,
      queue: buildQueue(sessions, this.now()),
      harnesses: this.opts.harnesses,
      recentCwds: this.registry.recentCwds(),
    };
  }

  private broadcast(): void {
    const push: StatePush = { type: 'state', ...this.snapshot() };
    for (const subscriber of [...this.subscribers]) {
      try {
        writeJsonLine(subscriber, push);
      } catch {
        this.subscribers.delete(subscriber);
        subscriber.destroy();
      }
    }
  }

  private persist(): void {
    saveStateFile(this.stateFile, this.registry.toJSON());
  }

  private reply(socket: net.Socket, response: Response): void {
    if (socket.destroyed) return;
    writeJsonLine(socket, response);
    socket.end();
  }
}
