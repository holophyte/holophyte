'use node';

import Anthropic from '@anthropic-ai/sdk';
import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { action } from './_generated/server';

export const run = action({
  args: { repoId: v.id('repos') },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('Not authenticated');

    // Verify user has access to this repo
    await ctx.runQuery(internal.repos.verifyRepoAccess, {
      repoId: args.repoId,
      userId,
    });

    // Load visible, non-archived tasks
    const tasks = await ctx.runQuery(internal.tasks.listByRepoInternal, {
      repoId: args.repoId,
      userId,
    });

    if (tasks.length === 0) {
      await ctx.runMutation(internal.repos.updateSortOrder, {
        id: args.repoId,
        sortOrder: [],
      });
      return;
    }

    // Build compact payload for Claude
    const taskPayload = tasks.map((t) => ({
      id: t._id,
      title: t.title,
      description: t.description.slice(0, 200),
      status: t.status,
      priority: t.priority ?? 'none',
      labels: (t.labelIds ?? []).length,
      createdAt: new Date(t.createdAt).toISOString(),
    }));

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20250315',
      max_tokens: 4096,
      system: `You are a task prioritization assistant. Given a list of tasks with their metadata, return them ordered for optimal focus and momentum:
- High-priority and urgent tasks first
- Quick wins (short description, clear scope) surfaced early within each priority tier
- Related tasks grouped together (similar titles/descriptions)
- Lower priority items last

Return ONLY a JSON array of task ID strings in the optimal order. No explanation, no markdown, just the JSON array.`,
      messages: [
        {
          role: 'user',
          content: `Order these tasks for optimal focus and momentum. Return a JSON array of task IDs:\n\n${JSON.stringify(taskPayload, null, 2)}`,
        },
      ],
    });

    // Parse response
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    let sortedIds: string[];
    try {
      sortedIds = JSON.parse(textBlock.text);
    } catch {
      throw new Error('Failed to parse Claude response as JSON');
    }

    if (!Array.isArray(sortedIds)) {
      throw new Error('Claude response is not an array');
    }

    // Validate all IDs exist in our task set and build a typed array
    const taskById = new Map(tasks.map((t) => [t._id as string, t._id]));
    const seen = new Set<string>();
    const finalOrder: Array<(typeof tasks)[number]['_id']> = [];

    for (const id of sortedIds) {
      const typedId = taskById.get(id);
      if (typedId && !seen.has(id)) {
        finalOrder.push(typedId);
        seen.add(id);
      }
    }

    // Add any tasks Claude missed at the end
    for (const task of tasks) {
      if (!seen.has(task._id as string)) {
        finalOrder.push(task._id);
      }
    }

    await ctx.runMutation(internal.repos.updateSortOrder, {
      id: args.repoId,
      sortOrder: finalOrder,
    });
  },
});
