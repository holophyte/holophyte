/** Bramble-style wrappers around @opentui/react's testRender. */

import type { ReactNode } from 'react';
import { act } from 'react';
import { testRender } from '@opentui/react/test-utils';

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

export async function renderSetup(node: ReactNode) {
  const setup = await testRender(node, {
    width: 100,
    height: 50,
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
