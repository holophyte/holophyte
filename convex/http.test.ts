// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import schema from './schema';

const SECRET = 'test-internal-secret';
const PATH = '/api/internal/codex-models/replace';

beforeEach(() => {
  process.env.INTERNAL_API_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.INTERNAL_API_SECRET;
  vi.restoreAllMocks();
});

function post(
  t: ReturnType<typeof convexTest>,
  body: unknown,
  bearer: string | null = SECRET,
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (bearer !== null) headers.Authorization = `Bearer ${bearer}`;
  return t.fetch(PATH, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function makeModel(i = 0) {
  return {
    id: `model-${i}`,
    label: `Model ${i}`,
    description: `Description ${i}`,
  };
}

describe('POST /api/internal/codex-models/replace — auth', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const t = convexTest(schema);
    const res = await post(t, { models: [makeModel()] }, null);
    expect(res.status).toBe(401);

    const rows = await t.run((ctx) => ctx.db.query('codexModels').collect());
    expect(rows).toHaveLength(0);
  });

  it('returns 401 when the bearer token is wrong', async () => {
    const t = convexTest(schema);
    const res = await post(t, { models: [makeModel()] }, 'wrong-secret');
    expect(res.status).toBe(401);

    const rows = await t.run((ctx) => ctx.db.query('codexModels').collect());
    expect(rows).toHaveLength(0);
  });
});

describe('POST /api/internal/codex-models/replace — payload validation', () => {
  it('rejects 65 models with a generic 400', async () => {
    const t = convexTest(schema);
    const models = Array.from({ length: 65 }, (_, i) => makeModel(i));
    const res = await post(t, { models });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Invalid models payload');
  });

  it('rejects an entry whose id exceeds 256 chars', async () => {
    const t = convexTest(schema);
    const models = [{ ...makeModel(), id: 'x'.repeat(257) }];
    const res = await post(t, { models });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Invalid models payload');
  });

  it('rejects an entry with an empty label', async () => {
    const t = convexTest(schema);
    const models = [{ ...makeModel(), label: '' }];
    const res = await post(t, { models });
    expect(res.status).toBe(400);
  });

  it('rejects when models is not an array', async () => {
    const t = convexTest(schema);
    const res = await post(t, { models: 'nope' });
    expect(res.status).toBe(400);
  });

  it('accepts the boundary payload (64 models, 256-char fields)', async () => {
    const t = convexTest(schema);
    const pad = 'x'.repeat(256);
    const models = Array.from({ length: 64 }, (_, i) => ({
      id: `${i}`.padEnd(256, 'a'),
      label: pad,
      description: pad,
    }));
    const res = await post(t, { models });
    expect(res.status).toBe(200);

    const rows = await t.run((ctx) => ctx.db.query('codexModels').collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.models).toHaveLength(64);
  });
});

describe('POST /api/internal/codex-models/replace — smoke', () => {
  it('populates codexModels end-to-end with a valid bearer', async () => {
    const t = convexTest(schema);
    const models = [makeModel(1), makeModel(2)];
    const res = await post(t, { models });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    const rows = await t.run((ctx) => ctx.db.query('codexModels').collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.models).toEqual(models);
    expect(typeof rows[0]?.fetchedAt).toBe('number');
  });
});
