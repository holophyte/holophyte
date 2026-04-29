import { getActiveSessions as getClaudeActive } from '@/claude/manager';
import { getActiveSessions as getCodexActive } from '@/codex/manager';

/**
 * Returns the IDs of every session currently running across both the Claude
 * and Codex managers. Used by the companion's heartbeat loop so the active
 * count and per-session heartbeats include sessions from either provider.
 *
 * Lives in `src/server/` rather than either manager to avoid coupling the
 * two. Result is deduped via Set — by construction a session lives in only
 * one manager map, but dedup avoids double heartbeats / inflated counts if a
 * race ever transiently lists the same ID twice.
 */
export function getAllActiveSessions(): string[] {
  return Array.from(new Set([...getClaudeActive(), ...getCodexActive()]));
}
