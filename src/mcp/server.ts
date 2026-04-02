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
import { TaskPriority, TaskStatus } from '@convex/schema';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConvexHttpClient } from 'convex/browser';
import { z } from 'zod';
import { DEFAULT_MODEL } from '@/constants';
import { readApiKeyFile, signInWithApiKey } from '@/server/auth-token';

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
 * Bootstraps auth and initializes the ConvexHttpClient.
 * Requires a valid API key in ~/.holophyte/api-key — exits if missing or invalid.
 *
 * The API key is exchanged for a proper JWT via the `api-key` Convex Auth provider,
 * so the MCP client operates as the actual key owner.
 */
async function bootstrapAuth(convexUrl: string): Promise<void> {
  const apiKey = await readApiKeyFile();
  if (!apiKey) {
    console.error(
      'No API key found. Run `holophyte setup` to generate one, or create one in Settings > API Keys and save it to ~/.holophyte/api-key',
    );
    process.exit(1);
  }

  const result = await signInWithApiKey(convexUrl, apiKey, 'mcp');
  if (!result) {
    console.error(
      'API key authentication failed. The key may be revoked, expired, or missing the "mcp" scope. Generate a new key in Settings > API Keys.',
    );
    process.exit(1);
  }

  httpClient = new ConvexHttpClient(convexUrl);
  httpClient.setAuth(result.token);
  console.log('MCP server authenticated via API key');

  // Re-authenticate before JWT expires. Convex auth JWTs are short-lived (~1h),
  // but MCP stdio processes can run for hours (e.g. Claude Desktop).
  // If re-auth fails (key revoked/expired), exit immediately rather than
  // continuing with a stale JWT that will eventually expire anyway.
  const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
  setInterval(async () => {
    const fresh = await signInWithApiKey(convexUrl, apiKey, 'mcp');
    if (!fresh) {
      console.error(
        'API key re-authentication failed — key may have been revoked. Shutting down.',
      );
      process.exit(1);
    }
    if (httpClient) {
      httpClient.setAuth(fresh.token);
    }
  }, REFRESH_INTERVAL_MS).unref();
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

const taskPriorityEnum = z.enum([
  TaskPriority.None,
  TaskPriority.Low,
  TaskPriority.Medium,
  TaskPriority.High,
  TaskPriority.Urgent,
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

// ── Tool: holophyte_list_labels ──────────────────────────────────────

server.tool(
  'holophyte_list_labels',
  'List labels for an organization',
  {
    orgId: z
      .string()
      .optional()
      .describe('Organization ID (uses default org if omitted)'),
  },
  async ({ orgId }) => {
    const client = requireClient();
    const labels = await client.query(api.labels.list, {
      orgId: requireOrgId(orgId),
    });
    return jsonResponse(
      labels.map((l) => ({ id: l._id, name: l.name, color: l.color })),
    );
  },
);

// ── Tool: holophyte_create_label ─────────────────────────────────────

server.tool(
  'holophyte_create_label',
  'Create a new label in an organization',
  {
    name: z.string().describe('Label name'),
    color: z.string().describe('Label color (e.g. "#ff0000" or "red")'),
    orgId: z
      .string()
      .optional()
      .describe('Organization ID (uses default org if omitted)'),
    personal: z
      .boolean()
      .optional()
      .describe('If true, label is only visible to the creating user'),
  },
  async ({ name, color, orgId, personal }) => {
    const client = requireClient();
    const resolvedOrgId = requireOrgId(orgId);
    const labelId = await client.mutation(api.labels.create, {
      name,
      color,
      orgId: resolvedOrgId,
      personal,
    });
    return jsonResponse({ id: labelId, name, color });
  },
);

// ── Label name resolution ───────────────────────────────────────────

/** Convex document IDs are base32-encoded and always start with a specific set of chars. */
const CONVEX_ID_PATTERN = /^[a-z0-9][a-z0-9_|]+$/;

/**
 * Resolves an array of label identifiers (IDs or names) to label IDs.
 * Names are matched case-insensitively against the org's labels.
 * Inputs that look like Convex IDs (alphanumeric) pass through directly.
 * Inputs that don't match a name and don't look like IDs throw an error.
 */
async function resolveLabels(
  client: ConvexHttpClient,
  labelInputs: string[],
  orgId: Id<'organizations'>,
): Promise<Id<'labels'>[]> {
  const allLabels = await client.query(api.labels.list, { orgId });
  const labelsByName = new Map(
    allLabels.map((l: { _id: string; name: string }) => [
      l.name.toLowerCase(),
      l._id,
    ]),
  );

  const resolved: Id<'labels'>[] = [];
  const unresolved: string[] = [];

  for (const input of labelInputs) {
    const byName = labelsByName.get(input.toLowerCase());
    if (byName) {
      resolved.push(byName as Id<'labels'>);
    } else if (CONVEX_ID_PATTERN.test(input)) {
      // Looks like a Convex ID — pass through
      resolved.push(input as Id<'labels'>);
    } else {
      unresolved.push(input);
    }
  }

  if (unresolved.length) {
    const available = allLabels.map((l: { name: string }) => l.name).join(', ');
    throw new Error(
      `Unknown label(s): ${unresolved.join(', ')}. Available labels: ${available || '(none)'}`,
    );
  }

  return resolved;
}

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
    priority: taskPriorityEnum
      .optional()
      .describe('Task priority (default: none)'),
    labels: z
      .array(z.string())
      .optional()
      .describe(
        'Label IDs or names to attach to the task (names are resolved to IDs)',
      ),
  },
  async ({ repoId, title, prompt, description, status, priority, labels }) => {
    const client = requireClient();
    let labelIds: Id<'labels'>[] | undefined;
    if (labels?.length) {
      labelIds = await resolveLabels(client, labels, requireOrgId());
    }
    const taskId = await client.mutation(api.tasks.create, {
      repoId: repoId as Id<'repos'>,
      title,
      prompt,
      description,
      status,
      priority,
      labelIds,
    });
    return jsonResponse({
      id: taskId,
      title,
      status: status ?? TaskStatus.Backlog,
      priority: priority ?? TaskPriority.None,
      labelIds: labelIds ?? [],
    });
  },
);

// ── Tool: holophyte_update_task ──────────────────────────────────────

server.tool(
  'holophyte_update_task',
  'Update a task (title, prompt, description, status, priority, or labels). Labels are replaced wholesale — pass the full desired label set.',
  {
    id: z.string().describe('Task ID'),
    title: z.string().optional().describe('New title'),
    prompt: z.string().optional().describe('New prompt'),
    description: z.string().optional().describe('New description'),
    status: taskStatusWithArchivedEnum.optional().describe('New status'),
    priority: taskPriorityEnum.optional().describe('New priority'),
    labels: z
      .array(z.string())
      .optional()
      .describe(
        'Label IDs or names to set on the task (names are resolved to IDs, replaces all existing labels)',
      ),
  },
  async ({ id, title, prompt, description, status, priority, labels }) => {
    const client = requireClient();
    const taskId = id as Id<'tasks'>;

    // Resolve label names to IDs if provided
    let labelIds: Id<'labels'>[] | undefined;
    if (labels !== undefined) {
      labelIds = labels.length
        ? await resolveLabels(client, labels, requireOrgId())
        : [];
    }

    // Update fields (title, prompt, description, priority, labels)
    if (
      title !== undefined ||
      prompt !== undefined ||
      description !== undefined ||
      priority !== undefined ||
      labelIds !== undefined
    ) {
      await client.mutation(api.tasks.update, {
        id: taskId,
        title,
        prompt,
        description,
        priority,
        labelIds,
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
