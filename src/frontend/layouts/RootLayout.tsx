import { Outlet, useMatch } from '@tanstack/react-router';
import { Authenticated, AuthLoading, Unauthenticated } from 'convex/react';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/frontend/hooks/useTheme';
import { allowPasswordAuth, e2eTest } from '@/frontend/lib/config';
import AutoTestAuth from '../components/AutoTestAuth';
import { CommandPalette } from '../components/CommandPalette';
import { Sidebar } from '../components/Sidebar';
import SignInPage from '../components/SignInPage';
import TaskDetailPanel from '../components/TaskDetailPanel';

const PANEL_TRANSITION_MS = 300;

function AnimatedTaskDetailPanel({ open }: { open: boolean }) {
  const [shouldRender, setShouldRender] = useState(open);
  const [isVisible, setIsVisible] = useState(open);
  const firstRenderRef = useRef(true);

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      setShouldRender(open);
      setIsVisible(open);
      return;
    }

    if (open) {
      setShouldRender(true);
      const frame = window.requestAnimationFrame(() => setIsVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }

    setIsVisible(false);
    const timeoutId = window.setTimeout(
      () => setShouldRender(false),
      PANEL_TRANSITION_MS,
    );
    return () => window.clearTimeout(timeoutId);
  }, [open]);

  if (!shouldRender) return null;

  return <TaskDetailPanel isOpen={isVisible} />;
}

function AuthenticatedLayout() {
  // Show TaskDetailPanel when on the task detail route but NOT on the task page route
  const taskDetailMatch = useMatch({
    from: '/repos/$repoId/tasks/$taskId',
    shouldThrow: false,
  });
  const taskPageMatch = useMatch({
    from: '/repos/$repoId/tasks/$taskId/page',
    shouldThrow: false,
  });

  const showTaskDetailPanel = !!taskDetailMatch && !taskPageMatch;

  return (
    <div className="flex h-screen bg-background text-foreground relative">
      <Sidebar />
      <main className="relative flex-1 flex flex-col overflow-hidden">
        <Outlet />
        <AnimatedTaskDetailPanel open={showTaskDetailPanel} />
      </main>
      <CommandPalette />
    </div>
  );
}

export default function RootLayout() {
  useTheme();
  const hasSigninQuery = new URLSearchParams(window.location.search).has(
    'signin',
  );

  const spinner = (
    <div className="flex h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 motion-safe:animate-spin text-muted-foreground" />
    </div>
  );

  return (
    <>
      {allowPasswordAuth && !hasSigninQuery && <AutoTestAuth />}
      <AuthLoading>{spinner}</AuthLoading>
      <Unauthenticated>
        {e2eTest && !allowPasswordAuth ? spinner : <SignInPage />}
      </Unauthenticated>
      <Authenticated>
        <AuthenticatedLayout />
      </Authenticated>
    </>
  );
}
