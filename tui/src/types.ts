/**
 * Shared domain types for holo — the attention queue TUI.
 * See spec.md for the full design. These types are the contract between
 * the daemon, the CLI, the hook adapters, and the TUI.
 */

export type HarnessId = 'claude' | 'codex' | 'cursor' | 'devin' | 'fake';

export type SessionStatus =
  | 'running'
  | 'needs_input'
  | 'permission'
  | 'idle'
  | 'error'
  | 'exited';

export interface PendingPermission {
  tool: string;
  input: unknown;
  /** epoch ms — daemon auto-releases the held hook connection at this deadline */
  respondBy: number;
}

export interface Session {
  /** "claude-1", "codex-2", ... */
  id: string;
  harness: HarnessId;
  /** repo path the agent runs in */
  cwd: string;
  /** tmux window id (e.g. "@3") — stable across window renames/reorders */
  tmuxWindow: string;
  status: SessionStatus;
  /** "Approve database migration", "Clarify naming convention", ... */
  attentionReason?: string;
  /** agent's last output message (from stop/notification payloads) */
  lastMessage?: string;
  pendingPermission?: PendingPermission;
  createdAt: number;
  /** when `status` last changed — drives elapsed display + aging bonus */
  statusSince: number;
  /** harness-native conversation id, captured from the SessionStart hook payload (claude also pins it at spawn via --session-id) */
  harnessSessionId?: string;
}

export interface HarnessInfo {
  id: HarnessId;
  /** false → shown grayed in the new-session picker, not hidden */
  configured: boolean;
}

export interface QueueItem {
  sessionId: string;
  score: number;
  /** short human label for the queue row ("approve Bash", "review changes") */
  reason: string;
}

export interface StateSnapshot {
  sessions: Session[];
  /** scored, sorted descending — top item is "the next thing" */
  queue: QueueItem[];
  /** which harnesses are usable on this machine (for the new-session picker) */
  harnesses: HarnessInfo[];
  /** most-recent-first spawn targets (for the cwd picker), deduped, capped */
  recentCwds: string[];
}

export interface HarnessAdapter {
  id: HarnessId;
  /**
   * argv to exec inside the session's tmux window. May write per-session
   * config first (e.g. ~/.holo/sessions/<id>/settings.json with injected
   * hooks) — hence async is allowed.
   */
  spawnCommand(session: Session): string[] | Promise<string[]>;
  /**
   * argv that resumes session.harnessSessionId's conversation in a fresh
   * process. Absent → this harness cannot resume. Like spawnCommand, may
   * write per-session config first — hence async is allowed.
   */
  resumeCommand?(session: Session): string[] | Promise<string[]>;
  /** one-time global setup (config writes) — only if unavoidable */
  setup?(): Promise<void>;
  /** whether this harness is usable on this machine (binary on PATH etc.) */
  configured(): boolean | Promise<boolean>;
  capabilities: {
    /** can approve/deny permission prompts from the queue without attaching */
    remotePermission: boolean;
    /** surfaces the agent's question text in needs_input items */
    questionText: boolean;
  };
}
