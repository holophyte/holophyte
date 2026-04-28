import { getActiveSessions as getClaudeActive } from '@/claude/manager';
import { getActiveSessions as getCodexActive } from '@/codex/manager';

/**
 * Returns the IDs of every session currently running across both the Claude
 * and Codex managers. Used by the companion's heartbeat loop so the active
 * count and per-session heartbeats include sessions from either provider.
 *
 * Lives in `src/server/` rather than either manager to avoid coupling the
 * two. Order is Claude IDs followed by Codex IDs; callers should not rely on
 * the order.
 */
export function getAllActiveSessions(): string[] {
  return [...getClaudeActive(), ...getCodexActive()];
}
