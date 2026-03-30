// ── Holophyte MCP Server ─────────────────────────────────────────────
//
// Exposes Holophyte's project management capabilities to MCP clients.
// Runs as a stdio subprocess — registered in ~/.claude.json under mcpServers.
// Talks to Convex directly using ConvexHttpClient (one-shot queries/mutations).
//
// Redirect console.log to stderr so stray log output from imported modules
// doesn't corrupt the MCP stdio protocol. In Bun, this top-level statement
// runs before ES module imports are evaluated (unlike the spec, where imports
// are hoisted). If this ever breaks, move the override to a separate preload file.

console.log = (...args: unknown[]) => console.error(...args);

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { TaskStatus } from '@convex/schema';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConvexHttpClient } from 'convex/browser';
import { z } from 'zod';
import { DEFAULT_MODEL } from '@/constants';
import {
  readApiKeyFile,
  readTokenFile,
  signInAnonymous,
} from '@/server/auth-token';

// ── Types ────────────────────────────────────────────────────────────

interface OrgInfo {
  _id: Id<'organizations'>;
  name: string;
  slug: string;
  personal?: boolean;
  role: string;
}

// ── Convex client setup ──────────────────────────────────────────────

let httpClient: ConvexHttpClient | null = null;
let defaultOrgId: Id<'organizations'> | null = null;

/**
 * Derives the Convex HTTP site URL from env vars.
 * Uses CONVEX_SITE_URL if set; for cloud deployments, derives from CONVEX_URL
 * by replacing .convex.cloud with .convex.site.
 */
function deriveSiteUrl(convexUrl: string): string {
  if (process.env.CONVEX_SITE_URL) {
    return process.env.CONVEX_SITE_URL.replace(/\/$/, '');
  }
  // Cloud: https://foo.convex.cloud → https://foo.convex.site
  return convexUrl
    .replace(/\.convex\.cloud$/, '.convex.site')
    .replace(/\/$/, '');
}

/**
 * Bootstraps auth and initializes the ConvexHttpClient.
 * Auth priority: API key file → token file → anonymous fallback.
 */
async function bootstrapAuth(convexUrl: string): Promise<void> {
  const deployment = process.env.CONVEX_DEPLOYMENT;
  const siteUrl = deriveSiteUrl(convexUrl);

  // 1. Try API key from ~/.holophyte/api-key
  const apiKey = await readApiKeyFile();
  if (apiKey) {
    try {
      const resp = await fetch(`${siteUrl}/api/keys/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, scope: 'mcp' }),
      });
      if (resp.ok) {
        const body = (await resp.json()) as { userId?: string };
        console.log(
          `MCP server authenticated via API key (userId: ${body.userId ?? 'unknown'})`,
        );
        // API key is a valid identity gate; proceed with remaining auth for Convex client
      } else if (resp.status === 401 || resp.status === 403) {
        console.error(
          `API key validation failed (${resp.status}) — refusing to start`,
        );
        throw new Error(
          `API key authentication failed with status ${resp.status}`,
        );
      } else {
        console.error(
          `API key exchange returned unexpected status ${resp.status} — falling through to other auth methods`,
        );
      }
    } catch (err) {
      // Re-throw auth failures; treat network errors as fall-through
      if (
        err instanceof Error &&
        err.message.startsWith('API key authentication failed')
      ) {
        throw err;
      }
      console.error(
        'API key exchange unreachable — falling through to other auth methods:',
        err,
      );
    }
  }

  let token: string | null = null;

  // 2. Try token file
  if (deployment) {
    const result = await readTokenFile(deployment);
    if (result.status === 'ok') {
      const normalize = (u: string) => u.replace(/\/$/, '');
      if (normalize(result.data.convexUrl) === normalize(convexUrl)) {
        token = result.data.token;
        console.log('MCP server authenticated via stored token');
      } else if (process.env.ALLOW_ANONYMOUS_AUTH === '1') {
        console.log('Token URL mismatch, falling back to anonymous auth');
      }
    }
  }

  // 3. Anonymous auth fallback
  if (!token && process.env.ALLOW_ANONYMOUS_AUTH === '1') {
    const anonResult = await signInAnonymous(convexUrl);
    if (anonResult) {
      token = anonResult.token;
      console.log('MCP server authenticated anonymously (local dev mode)');
    }
  }

  httpClient = new ConvexHttpClient(convexUrl);
  if (token) {
    httpClient.setAuth(token);
  }
}

/**
 * Resolves the default orgId from the user's memberships.
 * Prefers personal org; falls back to the first org found.
 */
async function resolveDefaultOrg(): Promise<void> {
  if (!httpClient) return;
  const orgs = (await httpClient.query(
    api.organizations.listByUser,
  )) as OrgInfo[];
  if (orgs.length === 0) {
    console.log('Warning: No organizations found for this user');
    return;
  }
  const personal = orgs.find((o) => o.personal);
  const firstOrg = orgs[0];
  if (!firstOrg) return; // Already checked orgs.length above, but satisfies TS
  defaultOrgId = personal ? personal._id : firstOrg._id;
  console.log(
    `Default org: ${personal?.name ?? firstOrg.name} (${defaultOrgId})`,
  );
}

function requireClient(): ConvexHttpClient {
  if (!httpClient) throw new Error('Convex client not initialized');
  return httpClient;
}

function requireOrgId(orgIdArg?: string): Id<'organizations'> {
  const orgId = orgIdArg ?? defaultOrgId;
  if (!orgId) throw new Error('No orgId provided and no default org resolved');
  return orgId as Id<'organizations'>;
}

/** Wraps a value as a JSON text response for MCP tool results. */
function jsonResponse(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

/** Wraps a plain text string as an MCP tool result. */
function textResponse(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

/** Returns an MCP error result with the given message. */
function errorResponse(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

// ── MCP Server ───────────────────────────────────────────────────────

const server = new McpServer({
  name: 'holophyte',
  version: '1.0.0',
});

const taskStatusEnum = z.enum([
  TaskStatus.Backlog,
  TaskStatus.Todo,
  TaskStatus.InProgress,
  TaskStatus.Review,
  TaskStatus.Done,
]);

const taskStatusWithArchivedEnum = z.enum([
  TaskStatus.Backlog,
  TaskStatus.Todo,
  TaskStatus.InProgress,
  TaskStatus.Review,
  TaskStatus.Done,
  TaskStatus.Archived,
]);

// ── Tool: holophyte_list_repos ───────────────────────────────────────

server.tool(
  'holophyte_list_repos',
  'List repos for an organization',
  {
    orgId: z
      .string()
      .optional()
      .describe('Organization ID (uses default org if omitted)'),
  },
  async ({ orgId }) => {
    const client = requireClient();
    const repos = await client.query(api.repos.list, {
      orgId: requireOrgId(orgId),
    });
    return jsonResponse(
      repos.map((r) => ({ id: r._id, name: r.name, path: r.path })),
    );
  },
);

// ── Tool: holophyte_list_tasks ───────────────────────────────────────

server.tool(
  'holophyte_list_tasks',
  'List tasks with optional filters (by repo or org-wide)',
  {
    repoId: z
      .string()
      .optional()
      .describe('Repo ID to filter by (lists all org tasks if omitted)'),
    orgId: z
      .string()
      .optional()
      .describe('Organization ID (uses default org if omitted)'),
    status: taskStatusWithArchivedEnum.optional().describe('Filter by status'),
    includeArchived: z
      .boolean()
      .optional()
      .describe(
        'Include archived tasks (default: false, auto-enabled when status=archived)',
      ),
  },
  async ({ repoId, orgId, status, includeArchived }) => {
    const client = requireClient();
    // Auto-include archived tasks when explicitly filtering for them
    const shouldIncludeArchived = includeArchived ?? status === 'archived';
    const allTasks = repoId
      ? await client.query(api.tasks.listByRepo, {
          repoId: repoId as Id<'repos'>,
          includeArchived: shouldIncludeArchived,
        })
      : await client.query(api.tasks.listAll, {
          orgId: requireOrgId(orgId),
          includeArchived: shouldIncludeArchived,
        });
    const tasks = status
      ? allTasks.filter((t) => t.status === status)
      : allTasks;
    return jsonResponse(
      tasks.map((t) => ({
        id: t._id,
        title: t.title,
        status: t.status,
        repoId: t.repoId,
        priority: t.priority,
        prompt: t.prompt
          ? `${t.prompt.slice(0, 100)}${t.prompt.length > 100 ? '...' : ''}`
          : '',
      })),
    );
  },
);

// ── Tool: holophyte_get_task ─────────────────────────────────────────

server.tool(
  'holophyte_get_task',
  'Get full task details including prompt, subtasks, labels, and latest session',
  { id: z.string().describe('Task ID') },
  async ({ id }) => {
    const client = requireClient();
    const task = await client.query(api.tasks.get, {
      id: id as Id<'tasks'>,
    });
    if (!task) return errorResponse('Task not found');
    return jsonResponse({
      id: task._id,
      title: task.title,
      description: task.description,
      prompt: task.prompt,
      status: task.status,
      priority: task.priority,
      repoId: task.repoId,
      repoName: task.repo?.name,
      repoPath: task.repo?.path,
      labels: task.labels?.map((l) => ({
        id: l._id,
        name: l.name,
        color: l.color,
      })),
      subtaskTotal: task.subtaskTotal,
      subtaskCompleted: task.subtaskCompleted,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    });
  },
);

// ── Tool: holophyte_create_task ──────────────────────────────────────

server.tool(
  'holophyte_create_task',
  'Create a new task in a repo',
  {
    repoId: z.string().describe('Repo ID to create the task in'),
    title: z.string().describe('Task title'),
    prompt: z.string().optional().describe('Task prompt'),
    description: z.string().optional().describe('Task description'),
    status: taskStatusEnum
      .optional()
      .describe('Initial status (default: backlog)'),
  },
  async ({ repoId, title, prompt, description, status }) => {
    const client = requireClient();
    const taskId = await client.mutation(api.tasks.create, {
      repoId: repoId as Id<'repos'>,
      title,
      prompt,
      description,
      status,
    });
    return jsonResponse({ id: taskId, title, status: status ?? 'backlog' });
  },
);

// ── Tool: holophyte_update_task ──────────────────────────────────────

server.tool(
  'holophyte_update_task',
  'Update a task (title, prompt, description, or status)',
  {
    id: z.string().describe('Task ID'),
    title: z.string().optional().describe('New title'),
    prompt: z.string().optional().describe('New prompt'),
    description: z.string().optional().describe('New description'),
    status: taskStatusWithArchivedEnum.optional().describe('New status'),
  },
  async ({ id, title, prompt, description, status }) => {
    const client = requireClient();
    const taskId = id as Id<'tasks'>;

    // Update fields (title, prompt, description)
    if (
      title !== undefined ||
      prompt !== undefined ||
      description !== undefined
    ) {
      await client.mutation(api.tasks.update, {
        id: taskId,
        title,
        prompt,
        description,
      });
    }

    // Move to new status (separate mutation with position at bottom of column)
    if (status) {
      const task = await client.query(api.tasks.get, { id: taskId });
      if (!task) {
        return errorResponse(
          'Task fields were updated but the task was deleted before the status change could be applied.',
        );
      }
      const existingTasks = await client.query(api.tasks.listByRepo, {
        repoId: task.repoId,
        includeArchived: true,
      });
      const tasksInTargetStatus = existingTasks.filter(
        (t) => t.status === status,
      );
      const maxPosition = tasksInTargetStatus.reduce(
        (max, t) => Math.max(max, t.position),
        0,
      );
      await client.mutation(api.tasks.move, {
        id: taskId,
        status,
        position: maxPosition + 1,
      });
    }

    return textResponse(`Task ${id} updated successfully`);
  },
);

// ── Tool: holophyte_get_session ──────────────────────────────────────

server.tool(
  'holophyte_get_session',
  'Get session status, model, and whether it is waiting for approval',
  { id: z.string().describe('Session ID') },
  async ({ id }) => {
    const client = requireClient();
    const session = await client.query(api.sessions.get, {
      id: id as Id<'sessions'>,
    });
    if (!session) return errorResponse('Session not found');
    return jsonResponse({
      id: session._id,
      taskId: session.taskId,
      status: session.status,
      model: session.model,
      permissionMode: session.permissionMode,
      startedAt: session.startedAt,
      lastActivityAt: session.lastActivityAt,
      sdkSessionId: session.sdkSessionId,
    });
  },
);

// ── Tool: holophyte_launch_session ───────────────────────────────────

server.tool(
  'holophyte_launch_session',
  'Launch a new session for a task (requires a running companion process to pick it up)',
  {
    taskId: z.string().describe('Task ID to launch session for'),
    prompt: z
      .string()
      .optional()
      .describe('Prompt to send (uses task prompt if omitted)'),
    model: z
      .string()
      .optional()
      .describe(`Model to use (default: ${DEFAULT_MODEL})`),
  },
  async ({ taskId, prompt, model }) => {
    const client = requireClient();

    // Verify task exists and has a prompt
    const task = await client.query(api.tasks.get, {
      id: taskId as Id<'tasks'>,
    });
    if (!task) return errorResponse('Task not found');
    const effectivePrompt = prompt ?? task.prompt;
    if (!effectivePrompt) {
      return errorResponse(
        'No prompt provided and task has no prompt set. Provide a prompt or set one on the task first.',
      );
    }

    // Check companion status (best-effort)
    let companionWarning = '';
    if (defaultOrgId) {
      try {
        const status = await client.query(api.companion.getStatus, {
          orgId: defaultOrgId,
        });
        if (!status || Date.now() - status.lastSeen > 30_000) {
          companionWarning =
            '\n\nWarning: Companion process appears offline. The session will remain queued until a companion comes online (timeout: 10 minutes).';
        }
      } catch {
        // Non-fatal
      }
    }

    const sessionId = await client.mutation(api.sessions.create, {
      taskId: taskId as Id<'tasks'>,
      prompt: effectivePrompt,
      model,
    });

    return textResponse(
      `Session created: ${sessionId}\nStatus: queued (will start when companion picks it up)${companionWarning}`,
    );
  },
);

// ── Tool: holophyte_stop_session ─────────────────────────────────────

server.tool(
  'holophyte_stop_session',
  'Stop a running session',
  { id: z.string().describe('Session ID to stop') },
  async ({ id }) => {
    const client = requireClient();
    await client.mutation(api.sessions.requestStop, {
      id: id as Id<'sessions'>,
    });
    return textResponse(
      `Stop requested for session ${id}. The companion will abort the SDK process.`,
    );
  },
);

// ── Tool: holophyte_list_templates ───────────────────────────────────

server.tool(
  'holophyte_list_templates',
  'List prompt templates (global or per-repo)',
  {
    repoId: z
      .string()
      .optional()
      .describe('Repo ID to filter by (lists global templates if omitted)'),
  },
  async ({ repoId }) => {
    const client = requireClient();
    const templates = await client.query(api.promptTemplates.list, {
      repoId: repoId ? (repoId as Id<'repos'>) : undefined,
    });
    return jsonResponse(
      templates.map((t) => ({
        id: t._id,
        name: t.name,
        content: t.content,
        repoId: t.repoId,
      })),
    );
  },
);

// ── Tool: holophyte_board_summary ────────────────────────────────────

server.tool(
  'holophyte_board_summary',
  'Get a high-level summary of the board (task counts by status, active sessions)',
  {
    orgId: z
      .string()
      .optional()
      .describe('Organization ID (uses default org if omitted)'),
  },
  async ({ orgId }) => {
    const client = requireClient();
    const resolvedOrgId = requireOrgId(orgId);

    const [allTasks, runningSessions] = await Promise.all([
      client.query(api.tasks.listAll, {
        orgId: resolvedOrgId,
        includeArchived: true,
      }),
      client.query(api.sessions.listActive, { orgId: resolvedOrgId }),
    ]);

    // Count tasks by status
    const statusCounts: Record<string, number> = {};
    for (const task of allTasks) {
      statusCounts[task.status] = (statusCounts[task.status] ?? 0) + 1;
    }

    return jsonResponse({
      totalTasks: allTasks.length,
      byStatus: statusCounts,
      runningSessions: runningSessions.length,
    });
  },
);

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    console.error(
      'CONVEX_URL not set. Ensure .env.local exists (run `bun run convex:local` or `bun run convex:dev` first).',
    );
    process.exit(1);
  }

  await bootstrapAuth(convexUrl);
  await resolveDefaultOrg();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log('Holophyte MCP server started');

  // Graceful shutdown
  const shutdown = () => {
    console.log('Holophyte MCP server shutting down');
    httpClient = null;
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error starting MCP server:', err);
  process.exit(1);
});
