// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

async function setupUser(t: ReturnType<typeof convexTest>) {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert('users', { name: 'Companion User' });
  });
  return t.withIdentity({ subject: `${userId}|s1` });
}

const sampleA = [
  { id: 'gpt-5.4', label: 'GPT-5.4', description: 'Frontier' },
  {
    id: 'gpt-5.4-mini',
    label: 'GPT-5.4 Mini',
    description: 'Smaller frontier',
  },
];
const sampleB = [
  {
    id: 'gpt-5.3-codex',
    label: 'GPT-5.3 Codex',
    description: 'Codex-optimized',
  },
];

describe('codexModels.get', () => {
  it('returns null when no probe has run', async () => {
    const t = convexTest(schema);
    const authed = await setupUser(t);
    const result = await authed.query(api.codexModels.get, {});
    expect(result).toBeNull();
  });

  it('throws when called unauthenticated', async () => {
    const t = convexTest(schema);
    await expect(t.query(api.codexModels.get, {})).rejects.toThrow(
      'Not authenticated',
    );
  });
});

describe('codexModels.replace (internalMutation)', () => {
  it('inserts on first call and get() returns the models', async () => {
    const t = convexTest(schema);
    const authed = await setupUser(t);

    const before = Date.now();
    await t.mutation(internal.codexModels.replace, { models: sampleA });
    const row = await authed.query(api.codexModels.get, {});

    expect(row).not.toBeNull();
    expect(row?.models).toEqual(sampleA);
    expect(row?.fetchedAt).toBeGreaterThanOrEqual(before);
  });

  it('patches the existing row in place — never appends', async () => {
    const t = convexTest(schema);

    await t.mutation(internal.codexModels.replace, { models: sampleA });
    await t.mutation(internal.codexModels.replace, { models: sampleB });

    const rows = await t.run(async (ctx) =>
      ctx.db.query('codexModels').collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.models).toEqual(sampleB);
  });

  it('updates fetchedAt on every call', async () => {
    const t = convexTest(schema);
    const authed = await setupUser(t);

    await t.mutation(internal.codexModels.replace, { models: sampleA });
    const first = await authed.query(api.codexModels.get, {});
    await new Promise((r) => setTimeout(r, 5));
    await t.mutation(internal.codexModels.replace, { models: sampleB });
    const second = await authed.query(api.codexModels.get, {});

    expect(second?.fetchedAt).toBeGreaterThan(first?.fetchedAt ?? 0);
  });

  it('ignores empty snapshots so the cached row is not nullified', async () => {
    const t = convexTest(schema);
    const authed = await setupUser(t);

    await t.mutation(internal.codexModels.replace, { models: sampleA });
    await t.mutation(internal.codexModels.replace, { models: [] });

    const row = await authed.query(api.codexModels.get, {});
    expect(row?.models).toEqual(sampleA);
  });

  it('does not insert an empty row on a fresh DB', async () => {
    const t = convexTest(schema);

    await t.mutation(internal.codexModels.replace, { models: [] });

    const rows = await t.run(async (ctx) =>
      ctx.db.query('codexModels').collect(),
    );
    expect(rows).toHaveLength(0);
  });
});
