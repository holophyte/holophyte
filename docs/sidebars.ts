import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    'intro',
    'sessions',
    'local-development',
    'api-keys',
    'mcp-server',
    {
      type: 'category',
      label: 'Testing',
      items: ['testing/playwright-manual'],
    },
    {
      type: 'category',
      label: 'Archive',
      collapsed: true,
      items: ['archive/ai-elements-adoption'],
    },
  ],
};

export default sidebars;
