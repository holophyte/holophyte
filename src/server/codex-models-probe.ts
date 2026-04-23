/**
 * Wall-clock cap on the entire probe (spawn + initialize + RPC + close).
 * Belt-and-suspenders for Bun, where a missing `codex` binary has been
 * observed to leave the underlying spawn promise unresolved instead of
 * emitting an ENOENT error.
 */
const PROBE_TIMEOUT_MS = 15_000;

export interface ProbeTarget {
  siteUrl: string;
  secret: string;
}

/**
 * Spawn an ephemeral `codex app-server` subprocess, fetch the live model
 * list, and replace the `codexModels` Convex cache via the companion-only
 * HTTP action. Best-effort: callers swallow errors and fall back to
 * `CODEX_MODELS_FALLBACK` on the frontend.
 *
 * The `codex-app-server-client` import is dynamic so a missing binary does
 * not crash companion startup at module-load time. The wall-clock timeout
 * tears down the Codex subprocess even when `createClient`, `modelList`, or
 * `close` hangs — critical because `Promise.race` alone would only unblock
 * the caller while leaving the child process alive.
 */
export async function probeCodexModels(target: ProbeTarget): Promise<void> {
  const { createClient } = await import('codex-app-server-client');
  type Codex = Awaited<ReturnType<typeof createClient>>;

  let codex: Codex | null = null;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
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
      await replaceCodexModels(target, models);
    } finally {
      await codex.close().catch(() => undefined);
    }
  })();
  probe.catch(() => undefined);

  try {
    await Promise.race([probe, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function replaceCodexModels(
  { siteUrl, secret }: ProbeTarget,
  models: Array<{ id: string; label: string; description: string }>,
): Promise<void> {
  const res = await fetch(`${siteUrl}/api/internal/codex-models/replace`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ models }),
  });
  if (!res.ok) {
    throw new Error(`codex-models replace failed: ${res.status}`);
  }
}

let succeeded = false;
let inFlight = false;

/**
 * Kick off a background Codex model probe at most once per successful run.
 * Safe to call from companion startup and from the polling recovery path —
 * duplicate calls while a probe is in flight (or after one has succeeded)
 * no-op.
 */
export function ensureCodexModelsProbe(target: ProbeTarget): void {
  if (succeeded || inFlight) return;
  inFlight = true;
  void probeCodexModels(target)
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
