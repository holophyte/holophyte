import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook/react-vite';
import tailwindcss from '@tailwindcss/vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: '@storybook/react-vite',
  viteFinal(config) {
    config.plugins ??= [];
    config.plugins.push(tailwindcss());
    config.resolve ??= {};
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': resolve(__dirname, '..', 'src'),
      '@convex': resolve(__dirname, '..', 'convex'),
    };
    return config;
  },
};

export default config;
