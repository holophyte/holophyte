// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateClient = vi.fn();

vi.mock('codex-app-server-client', () => ({
  createClient: mockCreateClient,
}));

import {
  ensureCodexModelsProbe,
  probeCodexModels,
  resetCodexModelsProbeStateForTests,
} from './codex-models-probe';

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

function makeCodexStub(opts: { models?: Model[]; modelListError?: Error }) {
  const close = vi.fn().mockResolvedValue(undefined);
  const modelList = opts.modelListError
    ? vi.fn().mockRejectedValue(opts.modelListError)
    : vi.fn().mockResolvedValue({ data: opts.models ?? [], nextCursor: null });
  return { modelList, close };
}

const target = {
  siteUrl: 'https://example.convex.site',
  secret: 'test-secret',
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  mockCreateClient.mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetCodexModelsProbeStateForTests();
});

describe('probeCodexModels', () => {
  it('maps Model[] → {id,label,description} and POSTs to the HTTP action', async () => {
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

    await probeCodexModels(target);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://example.convex.site/api/internal/codex-models/replace',
    );
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer test-secret');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
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

    await probeCodexModels(target);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      models: Array<{ id: string }>;
    };
    expect(body.models.map((m) => m.id)).toEqual(['visible']);
    expect(codex.close).toHaveBeenCalledTimes(1);
  });

  it('skips the HTTP call when the probe returns no models', async () => {
    const codex = makeCodexStub({ models: [] });
    mockCreateClient.mockResolvedValue(codex);

    await probeCodexModels(target);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(codex.close).toHaveBeenCalledTimes(1);
  });

  it('skips the HTTP call when every model is hidden', async () => {
    const codex = makeCodexStub({ models: [makeModel({ hidden: true })] });
    mockCreateClient.mockResolvedValue(codex);

    await probeCodexModels(target);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(codex.close).toHaveBeenCalledTimes(1);
  });

  it('rejects when the HTTP action returns a non-2xx status', async () => {
    const codex = makeCodexStub({ models: [makeModel()] });
    mockCreateClient.mockResolvedValue(codex);
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));

    await expect(probeCodexModels(target)).rejects.toThrow(
      'codex-models replace failed: 401',
    );
    expect(codex.close).toHaveBeenCalledTimes(1);
  });

  it('surfaces createClient errors (missing binary) without calling close', async () => {
    const spawnError = new Error('spawn codex ENOENT');
    mockCreateClient.mockRejectedValue(spawnError);

    await expect(probeCodexModels(target)).rejects.toThrow(
      'spawn codex ENOENT',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still closes the subprocess when modelList throws', async () => {
    const codex = makeCodexStub({ modelListError: new Error('rpc timeout') });
    mockCreateClient.mockResolvedValue(codex);

    await expect(probeCodexModels(target)).rejects.toThrow('rpc timeout');
    expect(codex.close).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects with a timeout error when createClient hangs', async () => {
    vi.useFakeTimers();
    mockCreateClient.mockReturnValue(new Promise(() => undefined));

    const assertion = expect(probeCodexModels(target)).rejects.toThrow(
      'Codex model probe timed out',
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('closes the codex subprocess from the timeout path when modelList hangs', async () => {
    vi.useFakeTimers();
    const codex = {
      modelList: vi.fn().mockReturnValue(new Promise(() => undefined)),
      close: vi.fn().mockResolvedValue(undefined),
    };
    mockCreateClient.mockResolvedValue(codex);

    const probe = probeCodexModels(target);
    probe.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(probe).rejects.toThrow('Codex model probe timed out');
    expect(codex.close).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('closes the subprocess even when createClient resolves after the timeout', async () => {
    vi.useFakeTimers();
    const codex = {
      modelList: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    let resolveCreate!: (value: typeof codex) => void;
    mockCreateClient.mockReturnValue(
      new Promise<typeof codex>((resolve) => {
        resolveCreate = resolve;
      }),
    );

    const probe = probeCodexModels(target);
    probe.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(probe).rejects.toThrow('Codex model probe timed out');

    resolveCreate(codex);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(codex.close).toHaveBeenCalledTimes(1);
    expect(codex.modelList).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ensureCodexModelsProbe', () => {
  it('latches after a successful probe so repeat calls no-op', async () => {
    const codex = makeCodexStub({ models: [makeModel()] });
    mockCreateClient.mockResolvedValue(codex);

    ensureCodexModelsProbe(target);
    ensureCodexModelsProbe(target);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    ensureCodexModelsProbe(target);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries after a failed probe so the recovery path can refresh', async () => {
    const failingCodex = makeCodexStub({
      modelListError: new Error('rpc timeout'),
    });
    const succeedingCodex = makeCodexStub({ models: [makeModel()] });
    mockCreateClient
      .mockResolvedValueOnce(failingCodex)
      .mockResolvedValueOnce(succeedingCodex);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    ensureCodexModelsProbe(target);
    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        'Codex model-list probe failed:',
        expect.any(Error),
      );
    });
    expect(fetchMock).not.toHaveBeenCalled();

    ensureCodexModelsProbe(target);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    expect(mockCreateClient).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });

  it('swallows non-2xx errors from the HTTP action', async () => {
    const codex = makeCodexStub({ models: [makeModel()] });
    mockCreateClient.mockResolvedValue(codex);
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    ensureCodexModelsProbe(target);
    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        'Codex model-list probe failed:',
        expect.any(Error),
      );
    });
    errorSpy.mockRestore();
  });
});
