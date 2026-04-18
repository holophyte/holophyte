// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockCreateClient = vi.fn();

vi.mock('codex-app-server-client', () => ({
  createClient: mockCreateClient,
}));

import { api } from '@convex/_generated/api';
import type { ConvexClient } from 'convex/browser';
import { probeCodexModels } from './codex-models-probe';

type ModelListResponse = Awaited<
  ReturnType<
    typeof import('codex-app-server-client').AppServerClient.prototype.modelList
  >
>;
type Model = ModelListResponse['data'][number];

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'gpt-5.4',
    model: 'gpt-5.4',
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: 'GPT-5.4',
    description: 'Frontier',
    hidden: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: 'medium',
    inputModalities: [],
    supportsPersonality: false,
    additionalSpeedTiers: [],
    isDefault: false,
    ...overrides,
  };
}

function makeConvexClient() {
  return {
    mutation: vi.fn().mockResolvedValue(undefined),
  } as unknown as ConvexClient & {
    mutation: ReturnType<typeof vi.fn>;
  };
}

function makeCodexStub(opts: { models?: Model[]; modelListError?: Error }) {
  const close = vi.fn().mockResolvedValue(undefined);
  const modelList = opts.modelListError
    ? vi.fn().mockRejectedValue(opts.modelListError)
    : vi.fn().mockResolvedValue({ data: opts.models ?? [], nextCursor: null });
  return { modelList, close };
}

afterEach(() => {
  mockCreateClient.mockReset();
});

describe('probeCodexModels', () => {
  it('maps Model[] → {id,label,description} and calls the Convex mutation', async () => {
    const codex = makeCodexStub({
      models: [
        makeModel({
          id: 'gpt-5.4',
          displayName: 'GPT-5.4',
          description: 'Frontier',
        }),
        makeModel({
          id: 'gpt-5.4-mini',
          displayName: 'GPT-5.4 Mini',
          description: 'Smaller frontier',
        }),
      ],
    });
    mockCreateClient.mockResolvedValue(codex);
    const client = makeConvexClient();

    await probeCodexModels(client);

    expect(client.mutation).toHaveBeenCalledTimes(1);
    expect(client.mutation).toHaveBeenCalledWith(api.codexModels.replace, {
      models: [
        { id: 'gpt-5.4', label: 'GPT-5.4', description: 'Frontier' },
        {
          id: 'gpt-5.4-mini',
          label: 'GPT-5.4 Mini',
          description: 'Smaller frontier',
        },
      ],
    });
    expect(codex.close).toHaveBeenCalledTimes(1);
  });

  it('filters out hidden models', async () => {
    const codex = makeCodexStub({
      models: [
        makeModel({ id: 'visible', hidden: false }),
        makeModel({ id: 'secret', hidden: true }),
      ],
    });
    mockCreateClient.mockResolvedValue(codex);
    const client = makeConvexClient();

    await probeCodexModels(client);

    const [, args] = client.mutation.mock.calls[0] as [
      unknown,
      { models: Array<{ id: string }> },
    ];
    expect(args.models.map((m) => m.id)).toEqual(['visible']);
    expect(codex.close).toHaveBeenCalledTimes(1);
  });

  it('skips the mutation when the probe returns no models', async () => {
    const codex = makeCodexStub({ models: [] });
    mockCreateClient.mockResolvedValue(codex);
    const client = makeConvexClient();

    await probeCodexModels(client);

    expect(client.mutation).not.toHaveBeenCalled();
    expect(codex.close).toHaveBeenCalledTimes(1);
  });

  it('skips the mutation when every model is hidden', async () => {
    const codex = makeCodexStub({ models: [makeModel({ hidden: true })] });
    mockCreateClient.mockResolvedValue(codex);
    const client = makeConvexClient();

    await probeCodexModels(client);

    expect(client.mutation).not.toHaveBeenCalled();
    expect(codex.close).toHaveBeenCalledTimes(1);
  });

  it('surfaces createClient errors (missing binary) without calling close', async () => {
    const spawnError = new Error('spawn codex ENOENT');
    mockCreateClient.mockRejectedValue(spawnError);
    const client = makeConvexClient();

    await expect(probeCodexModels(client)).rejects.toThrow(
      'spawn codex ENOENT',
    );
    expect(client.mutation).not.toHaveBeenCalled();
  });

  it('still closes the subprocess when modelList throws', async () => {
    const codex = makeCodexStub({ modelListError: new Error('rpc timeout') });
    mockCreateClient.mockResolvedValue(codex);
    const client = makeConvexClient();

    await expect(probeCodexModels(client)).rejects.toThrow('rpc timeout');
    expect(codex.close).toHaveBeenCalledTimes(1);
    expect(client.mutation).not.toHaveBeenCalled();
  });

  it('rejects with a timeout error when createClient hangs', async () => {
    vi.useFakeTimers();
    // Promise that never resolves — simulates Bun's ENOENT path where
    // createClient neither fulfils nor rejects.
    mockCreateClient.mockReturnValue(new Promise(() => undefined));
    const client = makeConvexClient();

    const assertion = expect(probeCodexModels(client)).rejects.toThrow(
      'Codex model probe timed out',
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;

    expect(client.mutation).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
