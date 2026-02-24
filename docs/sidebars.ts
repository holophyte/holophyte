import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    'intro',
    'sessions',
    'local-development',
    {
      type: 'category',
      label: 'Testing',
      items: ['testing/session-rethink', 'testing/playwright-manual'],
    },
  ],
};

export default sidebars;
