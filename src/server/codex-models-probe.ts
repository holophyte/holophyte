import { api } from '@convex/_generated/api';
import type { ConvexClient } from 'convex/browser';

/**
 * Wall-clock cap on the entire probe (spawn + initialize + RPC + close).
 * Belt-and-suspenders for Bun, where a missing `codex` binary has been
 * observed to leave the underlying spawn promise unresolved instead of
 * emitting an ENOENT error.
 */
const PROBE_TIMEOUT_MS = 15_000;

/**
 * Spawn an ephemeral `codex app-server` subprocess, fetch the live model
 * list, and replace the `codexModels` Convex cache. Best-effort: callers
 * swallow errors and fall back to `CODEX_MODELS_FALLBACK` on the frontend.
 *
 * The `codex-app-server-client` import is dynamic so a missing binary does
 * not crash companion startup at module-load time.
 */
export async function probeCodexModels(client: ConvexClient): Promise<void> {
  await withTimeout(
    runProbe(client),
    PROBE_TIMEOUT_MS,
    'Codex model probe timed out',
  );
}

async function runProbe(client: ConvexClient): Promise<void> {
  const { createClient } = await import('codex-app-server-client');
  const codex = await createClient({ defaultRequestTimeoutMs: 10_000 });
  try {
    const { data } = await codex.modelList();
    const models = data
      .filter((m) => !m.hidden)
      .map((m) => ({
        id: m.id,
        label: m.displayName,
        description: m.description,
      }));
    if (models.length === 0) return;
    await client.mutation(api.codexModels.replace, { models });
  } finally {
    await codex.close().catch(() => undefined);
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
