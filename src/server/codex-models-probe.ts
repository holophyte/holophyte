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
 * not crash companion startup at module-load time. The wall-clock timeout
 * tears down the Codex subprocess even when `createClient`, `modelList`, or
 * `close` hangs — critical because `Promise.race` alone would only unblock
 * the caller while leaving the child process alive.
 */
export async function probeCodexModels(client: ConvexClient): Promise<void> {
  const { createClient } = await import('codex-app-server-client');
  type Codex = Awaited<ReturnType<typeof createClient>>;

  let codex: Codex | null = null;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      // If the client is already live, kill the subprocess now. Otherwise
      // the probe branch below will close it as soon as `createClient`
      // resolves (which may happen long after the timeout fires).
      codex?.close().catch(() => undefined);
      reject(new Error('Codex model probe timed out'));
    }, PROBE_TIMEOUT_MS);
    timer.unref?.();
  });

  const probe = (async () => {
    codex = await createClient({ defaultRequestTimeoutMs: 10_000 });
    if (timedOut) {
      await codex.close().catch(() => undefined);
      return;
    }
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
  })();
  // Swallow late rejections from the losing side of the race so a timed-out
  // probe that eventually errors (e.g. subprocess crash) never triggers an
  // unhandled-rejection warning.
  probe.catch(() => undefined);

  try {
    await Promise.race([probe, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Latches for `ensureCodexModelsProbe`. `succeeded` is a one-shot gate after
// a successful refresh so we don't churn a subprocess on every companion
// poll. `inFlight` prevents concurrent probes while one is running. Failures
// leave both `false`, so the recovery path can retry after a transient
// spawn/RPC/network error.
let succeeded = false;
let inFlight = false;

/**
 * Kick off a background Codex model probe at most once per successful run.
 * Safe to call from companion startup and from the polling recovery path —
 * duplicate calls while a probe is in flight (or after one has succeeded)
 * no-op.
 */
export function ensureCodexModelsProbe(client: ConvexClient): void {
  if (succeeded || inFlight) return;
  inFlight = true;
  void probeCodexModels(client)
    .then(() => {
      succeeded = true;
    })
    .catch((err) => {
      console.error('Codex model-list probe failed:', err);
    })
    .finally(() => {
      inFlight = false;
    });
}

/** Test-only: clear both latches so unit tests can exercise retry paths. */
export function resetCodexModelsProbeStateForTests(): void {
  succeeded = false;
  inFlight = false;
}
