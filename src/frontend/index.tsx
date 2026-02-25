import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { RouterProvider } from '@tanstack/react-router';
import { ConvexReactClient } from 'convex/react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { setAllowAnonymousAuth, setE2eTest } from '@/frontend/lib/config';
import { router } from './router';
import './styles.css';

async function init() {
  // Fetch Convex URL from the server (env vars aren't available in the browser bundle)
  const res = await fetch('/api/config');
  const config = await res.json();
  const convexUrl = config.convexUrl;
  const isE2e = !!config.e2eTest;
  setE2eTest(isE2e);
  setAllowAnonymousAuth(!!config.allowAnonymousAuth);

  if (!convexUrl) {
    console.error('CONVEX_URL not configured');
    return;
  }

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

init();
