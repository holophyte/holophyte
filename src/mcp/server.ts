// ── Holophyte MCP Server ─────────────────────────────────────────────
//
// Exposes Holophyte's project management capabilities to MCP clients.
// Runs as a stdio subprocess — registered in ~/.claude.json under mcpServers.
// Talks to Convex directly using ConvexHttpClient (one-shot queries/mutations).
//
// CRITICAL: Redirect console.log to stderr BEFORE any imports that may log,
// since MCP uses stdout for JSON-RPC and any stray stdout output breaks the protocol.

const _origLog = console.log;
console.log = (...args: unknown[]) => console.error(...args);

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { TaskStatus } from '@convex/schema';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConvexHttpClient } from 'convex/browser';
import { z } from 'zod';
import { DEFAULT_MODEL } from '@/constants';
import { readTokenFile, signInAnonymous } from '@/server/auth-token';

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

function getDeployment(): string | undefined {
  return process.env.CONVEX_DEPLOYMENT;
}

/**
 * Bootstraps auth and initializes the ConvexHttpClient.
 * Replicates the companion's auth flow: token file → anonymous fallback.
 */
async function bootstrapAuth(convexUrl: string): Promise<void> {
  const deployment = getDeployment();

  let token: string | null = null;
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

  // Anonymous auth fallback
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

// ── MCP Server ───────────────────────────────────────────────────────

const server = new McpServer({
  name: 'holophyte',
  version: '1.0.0',
});

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
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            repos.map((r) => ({ id: r._id, name: r.name, path: r.path })),
            null,
            2,
          ),
        },
      ],
    };
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
    status: z
      .string()
      .optional()
      .describe(
        'Filter by status: backlog, todo, in_progress, review, done, archived',
      ),
    includeArchived: z
      .boolean()
      .optional()
      .describe('Include archived tasks (default: false)'),
  },
  async ({ repoId, orgId, status, includeArchived }) => {
    const client = requireClient();
    const allTasks = repoId
      ? await client.query(api.tasks.listByRepo, {
          repoId: repoId as Id<'repos'>,
          includeArchived: includeArchived ?? false,
        })
      : await client.query(api.tasks.listAll, {
          orgId: requireOrgId(orgId),
          includeArchived: includeArchived ?? false,
        });
    const tasks = status
      ? allTasks.filter((t) => t.status === status)
      : allTasks;
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
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
            null,
            2,
          ),
        },
      ],
    };
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
    if (!task) {
      return {
        content: [{ type: 'text' as const, text: 'Task not found' }],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
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
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ── Tool: holophyte_create_task ──────────────────────────────────────

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
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            { id: taskId, title, status: status ?? 'backlog' },
            null,
            2,
          ),
        },
      ],
    };
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
      if (task) {
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
    }

    return {
      content: [
        { type: 'text' as const, text: `Task ${id} updated successfully` },
      ],
    };
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
    if (!session) {
      return {
        content: [{ type: 'text' as const, text: 'Session not found' }],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              id: session._id,
              taskId: session.taskId,
              status: session.status,
              model: session.model,
              permissionMode: session.permissionMode,
              startedAt: session.startedAt,
              lastActivityAt: session.lastActivityAt,
              sdkSessionId: session.sdkSessionId,
            },
            null,
            2,
          ),
        },
      ],
    };
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
    if (!task) {
      return {
        content: [{ type: 'text' as const, text: 'Task not found' }],
        isError: true,
      };
    }
    const effectivePrompt = prompt ?? task.prompt;
    if (!effectivePrompt) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No prompt provided and task has no prompt set. Provide a prompt or set one on the task first.',
          },
        ],
        isError: true,
      };
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

    return {
      content: [
        {
          type: 'text' as const,
          text: `Session created: ${sessionId}\nStatus: queued (will start when companion picks it up)${companionWarning}`,
        },
      ],
    };
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
    return {
      content: [
        {
          type: 'text' as const,
          text: `Stop requested for session ${id}. The companion will abort the SDK process.`,
        },
      ],
    };
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
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            templates.map((t) => ({
              id: t._id,
              name: t.name,
              content: t.content,
              repoId: t.repoId,
            })),
            null,
            2,
          ),
        },
      ],
    };
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

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              totalTasks: allTasks.length,
              byStatus: statusCounts,
              runningSessions: runningSessions.length,
            },
            null,
            2,
          ),
        },
      ],
    };
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
