import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Set by init() from server config — used by App to skip auth gates in E2E
export let e2eTest = false;

async function init() {
  // Fetch Convex URL from the server (env vars aren't available in the browser bundle)
  const res = await fetch('/api/config');
  const config = await res.json();
  const convexUrl = config.convexUrl;
  e2eTest = !!config.e2eTest;

  if (!convexUrl) {
    console.error('CONVEX_URL not configured');
    return;
  }

  const convex = new ConvexReactClient(convexUrl);

  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('Root element not found');
  const root = createRoot(rootEl);

  // In E2E mode, skip auth provider — app renders immediately with queries in loading state
  const Provider = e2eTest ? ConvexProvider : ConvexAuthProvider;

  root.render(
    <React.StrictMode>
      <Provider client={convex}>
        <App />
      </Provider>
    </React.StrictMode>,
  );
}

init();
