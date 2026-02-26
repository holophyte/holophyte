import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { RouterProvider } from '@tanstack/react-router';
import { ConvexReactClient } from 'convex/react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { convexUrl } from '@/frontend/lib/config';
import { router } from './router';
import './styles.css';

// Config is injected synchronously by <script src="/config.js"> in index.html.
// No async fetch needed — values are available immediately via lib/config.

if (!convexUrl) {
  console.error('CONVEX_URL not configured — check /config.js');
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
