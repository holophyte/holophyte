/**
 * holod — the daemon's Unix socket server. Owns the session registry, the
 * spawn flow, held permission connections, and the tmux liveness sweep.
 * Every visible state change is persisted to the state file and broadcast
 * to subscribers as a StatePush.
 */

import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import net from 'node:net';
import { onJsonLines, writeJsonLine } from '../ndjson';
import { holoHome, socketPath, statePath, tmuxSessionName } from '../paths';
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
  QueueItem,
  Session,
  StateSnapshot,
} from '../types';
import { SessionRegistry } from './registry';
import { buildQueue } from './scoring';
import { loadStateFile, saveStateFile } from './state-file';
import { renderStatusLine, STATUS_STOPPED_LINE } from './status-line';

export interface DaemonOptions {
  tmux: Tmux;
  adapters: Record<HarnessId, HarnessAdapter>;
  /** initial configured flags — re-probed against the adapters on each sweep */
  harnesses: HarnessInfo[];
  /** argv for window 0 (the TUI) when creating the tmux session */
  tuiArgv: string[];
  /** argv for the per-agent-window sidebar pane (`holo sidebar`). Absent ⇒ sidebars disabled. */
  sidebarArgv?: string[];
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

/** longest stop() waits for the tombstone status write before giving up */
const TOMBSTONE_DEADLINE_MS = 1000;

/** sidebar pane width; the agent must keep ≥80 cols beside it + 1 separator col → 80+1+30 */
const SIDEBAR_COLS = 30;
const MIN_SIDEBAR_WINDOW_COLS = 111;

export class Daemon {
  private registry = new SessionRegistry();
  private server: net.Server | null = null;
  private readonly subscribers = new Set<net.Socket>();
  private readonly connections = new Set<net.Socket>();
  /** held permission connections, keyed by sessionId */
  private readonly holds = new Map<string, Hold>();
  /** old-session ids with a resume spawn in flight — blocks double-resume */
  private readonly resuming = new Set<string>();
  private sweepTimer: NodeJS.Timeout | null = null;
  private started = false;
  private stopping: Promise<void> | null = null;
  /** another daemon took over the socket path — stop without touching its socket/state */
  private takenOver = false;
  /** live configured flags — seeded from opts.harnesses, re-probed on each sweep */
  private harnesses: HarnessInfo[];
  /** queue of the last push — aging changes scores with time, not events */
  private lastBroadcastQueue: QueueItem[] | null = null;
  /** rendered line of the last push — dedupe, cleared each sweep so the line is re-asserted */
  private lastStatusLine: string | null = null;
  /** serializes set-option calls so rapid broadcasts can't land out of order */
  private statusChain: Promise<void> = Promise.resolve();
  /** window ids missing on the previous sweep — two consecutive misses terminate */
  private missingWindows = new Set<string>();
  private readonly now: () => number;
  private readonly sweepIntervalMs: number;
  private readonly permissionMaxHoldMs: number;
  // captured once — HOLO_HOME may change under us (tests swap it per case)
  private readonly socketFile = socketPath();
  private readonly stateFile = statePath();
  // pinned into spawned panes via tmux -e: panes otherwise inherit the tmux
  // SERVER's env, which may carry a different HOLO_HOME than this daemon's
  private readonly paneEnv: Record<string, string> = {
    HOLO_HOME: holoHome(),
    HOLO_TMUX_SESSION: tmuxSessionName(),
  };

  constructor(private readonly opts: DaemonOptions) {
    this.now = opts.now ?? Date.now;
    this.sweepIntervalMs = opts.sweepIntervalMs ?? 5000;
    this.permissionMaxHoldMs = opts.permissionMaxHoldMs ?? 90_000;
    this.harnesses = opts.harnesses;
  }

  async start(): Promise<void> {
    mkdirSync(holoHome(), { recursive: true });
    const persisted = loadStateFile(this.stateFile);
    this.registry = persisted
      ? SessionRegistry.fromJSON(persisted)
      : new SessionRegistry();

    // Bind-first: let the kernel arbitrate the socket path. A check-then-
    // unlink dance can delete a LIVE daemon's socket between check and bind.
    try {
      await this.listen();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
      // A stale socket file (dead daemon) refuses connections; a live daemon
      // accepts them even when too busy to reply promptly.
      const live = await this.probeSocketListener();
      if (live) throw new Error('holod already running');
      try {
        unlinkSync(this.socketFile);
      } catch {
        // raced away — the retry surfaces any real problem
      }
      await this.listen();
    }
    this.started = true;

    await this.sweepOnce();
    this.sweepTimer = setInterval(() => {
      this.sweepOnce().catch((err) => {
        console.error('holod sweep failed:', err);
      });
    }, this.sweepIntervalMs);
    this.sweepTimer.unref();
  }

  /**
   * Liveness probe for an EADDRINUSE socket path. Connect success — not a
   * reply — is the live signal: a busy daemon's starved event loop can delay
   * a ping reply past any deadline, but the kernel accepts the connection
   * regardless, while a dead daemon's stale file refuses it (ECONNREFUSED,
   * or ENOTSOCK when a crash left a regular file behind).
   * Ambiguity (connect hanging on a full backlog) counts as live — unlinking
   * the socket is the dangerous branch.
   */
  private probeSocketListener(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection(this.socketFile);
      const finish = (alive: boolean) => {
        clearTimeout(timer);
        socket.destroy();
        resolve(alive);
      };
      const timer = setTimeout(() => finish(true), 1000);
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
    });
  }

  private listen(): Promise<void> {
    const server = net.createServer((socket) => this.onConnection(socket));
    return new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.socketFile, () => {
        server.off('error', reject);
        this.server = server;
        resolve();
      });
    });
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
    // when another daemon took over, the socket path, state.json, and the
    // status line are ITS now — touching them here would clobber the live daemon
    if (!this.takenOver) {
      this.persist();
      try {
        unlinkSync(this.socketFile);
      } catch {
        // already gone (node unlinks unix sockets on server close)
      }
      // honest tombstone — counts are no longer live. Routed through the chain
      // so a content write queued before it can't land after it (writes queued
      // later are blocked by pushStatusLine's stopping guard); awaited because
      // main.ts calls process.exit right after stop() resolves — but raced
      // against a deadline so a wedged tmux can't hold shutdown hostage.
      this.statusChain = this.statusChain
        .then(() => this.opts.tmux.setStatusRight(STATUS_STOPPED_LINE))
        .catch(() => {});
      await Promise.race([
        this.statusChain,
        new Promise<void>((resolve) => {
          setTimeout(resolve, TOMBSTONE_DEADLINE_MS).unref();
        }),
      ]);
    }
  }

  /** Reconcile against live tmux windows + prune old exited sessions. */
  async sweepOnce(): Promise<void> {
    if (this.started && !existsSync(this.socketFile)) {
      // Our socket file is gone — another daemon took over the path. Bow out
      // instead of fighting it over tmux windows and state.json.
      this.takenOver = true;
      await this.stop();
      return;
    }
    // session options die with the tmux session and set-option against a
    // missing session is a silent no-op — re-assert once per sweep so a
    // recreated or externally clobbered holo session heals within one tick
    this.lastStatusLine = null;
    const liveIds = await this.opts.tmux.listWindowIds();
    // Two-strike termination: one bad list-windows sample must not destroy
    // session tracking, so a first-time-missing window still counts as live.
    const live = new Set(liveIds);
    const missing = new Set<string>();
    for (const session of this.registry.all()) {
      if (session.status === 'exited' || session.tmuxWindow === '') continue;
      if (!live.has(session.tmuxWindow)) missing.add(session.tmuxWindow);
    }
    const firstTimeMissing = [...missing].filter(
      (id) => !this.missingWindows.has(id),
    );
    this.missingWindows = missing;
    // run both — pruning must happen even when reconcile changed nothing
    const reconciled = this.registry.reconcile(
      [...liveIds, ...firstTimeMissing],
      this.now(),
    );
    const pruned = this.registry.pruneExited(this.now());
    const harnessesChanged = await this.refreshHarnesses();
    if (reconciled || pruned) {
      this.persist();
      this.broadcast();
    } else if (harnessesChanged || this.queueChanged()) {
      // aging bonus / configured-ness move with time, not with events
      this.broadcast();
    } else {
      const snap = this.snapshot();
      this.pushStatusLine(renderStatusLine(snap.sessions, snap.queue));
    }
  }

  /** Re-probe configured-ness — harnesses can be (un)installed while holod runs. */
  private async refreshHarnesses(): Promise<boolean> {
    const fresh = await Promise.all(
      this.harnesses.map(async ({ id }) => ({
        id,
        configured: await this.opts.adapters[id].configured(),
      })),
    );
    const changed = fresh.some(
      (info, i) => info.configured !== this.harnesses[i]?.configured,
    );
    this.harnesses = fresh;
    return changed;
  }

  /** Has the queue (order, scores, reasons) drifted since the last push? */
  private queueChanged(): boolean {
    const queue = buildQueue(this.registry.all(), this.now());
    const last = this.lastBroadcastQueue;
    if (last === null) return queue.length > 0;
    if (queue.length !== last.length) return true;
    return queue.some((item, i) => {
      const prev = last[i];
      return (
        prev === undefined ||
        prev.sessionId !== item.sessionId ||
        prev.score !== item.score ||
        prev.reason !== item.reason
      );
    });
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
        const changed = this.registry.applyEvent(
          req.sessionId,
          req.event,
          req.ts,
        );
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
        const push: StatePush = { type: 'state', ...this.snapshot() };
        this.lastBroadcastQueue = push.queue;
        writeJsonLine(socket, push);
        return;
      }
      case 'new':
        await this.handleNew(socket, req);
        return;
      case 'resume':
        await this.handleResume(socket, req);
        return;
      case 'next': {
        const queue = buildQueue(this.registry.all(), this.now());
        const top = queue[0];
        const session = top ? this.registry.get(top.sessionId) : undefined;
        if (!session) {
          // empty queue is a normal outcome, not a failure — ok, no session
          this.reply(socket, { ok: true });
          return;
        }
        await this.focusSession(session);
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
        await this.focusSession(session);
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
      this.reply(socket, {
        ok: false,
        error: `unknown harness: ${req.harness}`,
      });
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
      await this.opts.tmux.ensureSession(this.opts.tuiArgv, this.paneEnv);
      session = this.registry.createSession(req.harness, req.cwd, this.now());
      const argv = await adapter.spawnCommand(session);
      const spawned = await this.opts.tmux.newWindow({
        name: session.id,
        cwd: req.cwd,
        argv,
        env: this.paneEnv,
      });
      this.registry.setTmuxWindow(session.id, spawned.windowId, spawned.paneId);
      await this.opts.tmux.selectWindow(spawned.windowId); // jump-on-spawn per spec
      await this.trySpawnSidebar(
        session,
        spawned.windowId,
        spawned.paneId,
        spawned.width,
      );
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

  /**
   * Best-effort sidebar. Trap-then-split ordering is load-bearing: the split
   * happens only after the kill-window trap is armed on the agent pane, so a
   * sidebar can never outlive its agent and hold the window (and the session)
   * alive past the sweep. Any failure degrades to no sidebar — never a failed
   * spawn, never an untrapped split.
   */
  private async trySpawnSidebar(
    session: Session,
    windowId: string,
    agentPane: string,
    width: number,
  ): Promise<void> {
    const argv = this.opts.sidebarArgv;
    if (!argv || width < MIN_SIDEBAR_WINDOW_COLS) return;
    try {
      if (
        !(await this.opts.tmux.setKillWindowOnPaneDeath(agentPane, windowId))
      ) {
        return;
      }
      await this.opts.tmux.splitSidebar({
        paneId: agentPane,
        argv: [...argv, '--session', session.id],
        widthCols: SIDEBAR_COLS,
        env: this.paneEnv, // same HOLO_HOME/HOLO_TMUX_SESSION pinning as agent panes
      });
    } catch (err) {
      console.error('holod sidebar spawn failed:', err);
    }
  }

  /**
   * Focus a session's window, landing on the agent pane (not the sidebar).
   * agentPane is absent on pre-sidebar persisted state and sidebar-less
   * spawns, where window selection is enough.
   */
  private async focusSession(session: Session): Promise<void> {
    await this.opts.tmux.selectWindow(session.tmuxWindow);
    if (session.agentPane !== undefined) {
      await this.opts.tmux.selectPane(session.agentPane);
    }
  }

  /**
   * Respawn an exited session's conversation: mint a fresh session carrying
   * the old one's lineage, spawn via the adapter's resumeCommand, drop the
   * old record on success. Mirrors handleNew's skeleton deliberately — a
   * shared spawn helper is deferred until the sibling server.ts branch lands.
   */
  private async handleResume(
    socket: net.Socket,
    req: { sessionId: string },
  ): Promise<void> {
    const old = this.registry.get(req.sessionId);
    if (!old) {
      this.reply(socket, {
        ok: false,
        error: `unknown session: ${req.sessionId}`,
      });
      return;
    }
    if (old.status !== 'exited') {
      this.reply(socket, {
        ok: false,
        error: `session not exited: ${req.sessionId}`,
      });
      return;
    }
    const adapter = this.opts.adapters[old.harness] as
      | HarnessAdapter
      | undefined;
    if (!adapter?.resumeCommand) {
      this.reply(socket, {
        ok: false,
        error: `harness cannot resume: ${old.harness}`,
      });
      return;
    }
    if (old.harnessSessionId === undefined) {
      this.reply(socket, {
        ok: false,
        error: `no conversation id captured for ${req.sessionId}`,
      });
      return;
    }
    if (this.resuming.has(req.sessionId)) {
      this.reply(socket, {
        ok: false,
        error: `resume already in flight: ${req.sessionId}`,
      });
      return;
    }
    // capture lineage before any await — a sweep could prune `old` mid-flight
    const { harness, cwd, harnessSessionId, lastMessage } = old;
    this.resuming.add(req.sessionId);
    try {
      if (!(await adapter.configured())) {
        this.reply(socket, {
          ok: false,
          error: `harness not configured: ${harness}`,
        });
        return;
      }
      let session: Session | undefined;
      try {
        await this.opts.tmux.ensureSession(this.opts.tuiArgv, this.paneEnv);
        session = this.registry.createSession(harness, cwd, this.now());
        // adopted BEFORE spawning: if the resumed process dies at boot, the
        // new session exits still carrying the conversation id — retryable
        this.registry.adoptLineage(session.id, {
          harnessSessionId,
          lastMessage,
        });
        const argv = await adapter.resumeCommand(
          this.registry.get(session.id) ?? session,
        );
        // resumed sessions get the same window/pane/sidebar treatment as new
        const spawned = await this.opts.tmux.newWindow({
          name: session.id,
          cwd,
          argv,
          env: this.paneEnv,
        });
        this.registry.setTmuxWindow(
          session.id,
          spawned.windowId,
          spawned.paneId,
        );
        await this.trySpawnSidebar(
          session,
          spawned.windowId,
          spawned.paneId,
          spawned.width,
        );
      } catch (err) {
        if (session) this.registry.remove(session.id); // old exited record untouched — retryable
        this.persist(); // keep counters consistent on disk
        this.broadcast();
        this.reply(socket, { ok: false, error: String(err) });
        return;
      }
      this.registry.remove(req.sessionId); // lineage adopted — drop the old record now
      this.persist();
      this.broadcast();
      try {
        // jump-on-spawn, landing on the agent pane — same feel as handleNew
        await this.focusSession(this.registry.get(session.id) ?? session);
      } catch {
        // selection is cosmetic — the resumed session is live and tracked;
        // rolling back here would orphan a process that's consuming the conversation
      }
      this.reply(socket, {
        ok: true,
        session: this.registry.get(session.id) ?? session,
      });
    } finally {
      this.resuming.delete(req.sessionId);
    }
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
    // rare parallel-tool edge: the existing hold stays remotely answerable;
    // the newer request gets 'timeout' (silent hook exit → in-pane dialog)
    // and the registry remembers the pane is blocked on that dialog
    if (this.holds.has(req.sessionId)) {
      this.registry.notePaneDialog(req.sessionId, req.tool, req.ts);
      this.reply(socket, { ok: true, decision: 'timeout' });
      return;
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
      if (!hold || hold.socket !== socket) return; // already resolved
      this.holds.delete(req.sessionId);
      clearTimeout(hold.timer);
      // agent killed mid-hold — nothing is waiting for a decision anymore
      if (
        this.registry.resolvePermission(req.sessionId, 'timeout', this.now())
      ) {
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

  /** Failed-spawn cleanup — targeted removal of the half-created session. */
  private removeSession(id: string): void {
    this.registry.remove(id);
  }

  private snapshot(): StateSnapshot {
    const sessions = this.registry.all();
    return {
      sessions,
      queue: buildQueue(sessions, this.now()),
      harnesses: this.harnesses,
      recentCwds: this.registry.recentCwds(),
    };
  }

  private broadcast(): void {
    const push: StatePush = { type: 'state', ...this.snapshot() };
    this.lastBroadcastQueue = push.queue;
    for (const subscriber of [...this.subscribers]) {
      try {
        writeJsonLine(subscriber, push);
      } catch {
        this.subscribers.delete(subscriber);
        subscriber.destroy();
      }
    }
    this.pushStatusLine(renderStatusLine(push.sessions, push.queue));
  }

  /**
   * Dedupe latch: a failed write un-latches so the next state change retries
   * immediately; the per-sweep re-assert stays the backstop. The catch keeps
   * the chain resolved and the daemon alive through any tmux failure.
   */
  private pushStatusLine(line: string): void {
    // a continuation resuming after stop() began (in-flight sweep, spawn)
    // must not chain a live-content write onto the tombstone — doStop writes
    // the tombstone through the chain directly, so this blocks only content
    if (this.stopping) return;
    if (line === this.lastStatusLine) return;
    this.lastStatusLine = line;
    this.statusChain = this.statusChain
      .then(() => this.opts.tmux.setStatusRight(line))
      .catch((err) => {
        // a failed write must not claim success — un-latch so the next
        // broadcast retries before the sweep gets to it
        this.lastStatusLine = null;
        console.error('holod status line update failed:', err);
      });
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
