import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { RouterProvider } from '@tanstack/react-router';
import { ConvexReactClient } from 'convex/react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { convexUrl } from '@/frontend/lib/config';
import { router } from './router';
import './styles.css';

// Config is sourced from environment variables, inlined at build time by
// Bun.build() (static) or substituted at serve-time by Bun.serve() (dev).

if (!convexUrl) {
  console.error('CONVEX_URL not configured — check environment variables');
} else {
  const convex = new ConvexReactClient(convexUrl);

  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('Root element not found');
  const root = createRoot(rootEl);

  root.render(
    <React.StrictMode>
      <ConvexAuthProvider client={convex}>
        <RouterProvider router={router} />
      </ConvexAuthProvider>
    </React.StrictMode>,
  );
}
