import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    'intro',
    'architecture',
    'sessions',
    'local-development',
    {
      type: 'category',
      label: 'Testing',
      items: ['testing/playwright-manual'],
    },
  ],
};

export default sidebars;
