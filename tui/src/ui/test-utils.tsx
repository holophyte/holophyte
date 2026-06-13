/** Bramble-style wrappers around @opentui/react's testRender. */

import { testRender } from '@opentui/react/test-utils';
import type { ReactNode } from 'react';
import { act } from 'react';
import type { Request, Response, StatePush } from '../protocol';
import type { Gateway } from './gateway';

/** In-memory Gateway for UI tests — records requests, drives state pushes. */
export class FakeGateway implements Gateway {
  requests: Request[] = [];
  nextResponse: Response = { ok: true };
  subscribeCount = 0;
  private handlers: {
    onState: (s: StatePush) => void;
    onClose?: () => void;
  } | null = null;

  subscribe(handlers: {
    onState: (s: StatePush) => void;
    onClose?: () => void;
  }) {
    this.subscribeCount += 1;
    this.handlers = handlers;
    return {
      close: () => {
        this.handlers = null;
      },
    };
  }

  async request(req: Request): Promise<Response> {
    this.requests.push(req);
    return this.nextResponse;
  }

  pushState(s: StatePush) {
    this.handlers?.onState(s);
  }

  dropConnection() {
    const handlers = this.handlers;
    this.handlers = null;
    handlers?.onClose?.();
  }
}

export async function renderFrame(node: ReactNode): Promise<{
  frame: string;
  unmount(): void;
}> {
  const setup = await renderSetup(node);
  return {
    frame: setup.frame(),
    unmount: setup.unmount,
  };
}

export async function renderSetup(
  node: ReactNode,
  opts?: { width?: number; height?: number },
) {
  const setup = await testRender(node, {
    width: opts?.width ?? 100,
    height: opts?.height ?? 50,
    targetFps: 60,
  });
  await act(async () => {
    await setup.renderOnce();
  });
  return {
    ...setup,
    input: {
      async typeText(text: string) {
        await act(async () => {
          await setup.mockInput.typeText(text);
        });
      },
      pressKey(key: string) {
        act(() => {
          setup.mockInput.pressKey(key);
        });
      },
      pressEnter() {
        act(() => {
          setup.mockInput.pressEnter();
        });
      },
      // A lone ESC is an ambiguous escape-sequence prefix — the stdin parser
      // only emits it after its 20ms flush timeout, so wait that out.
      async pressEscape() {
        await act(async () => {
          setup.mockInput.pressEscape();
          await new Promise((resolve) => setTimeout(resolve, 40));
        });
      },
      pressTab(modifiers?: Parameters<typeof setup.mockInput.pressTab>[0]) {
        act(() => {
          setup.mockInput.pressTab(modifiers);
        });
      },
      pressArrow(direction: 'up' | 'down' | 'left' | 'right') {
        act(() => {
          setup.mockInput.pressArrow(direction);
        });
      },
    },
    async update() {
      await act(async () => {
        await setup.renderOnce();
      });
    },
    frame() {
      return setup.captureCharFrame();
    },
    unmount: () => setup.renderer.destroy(),
  };
}
