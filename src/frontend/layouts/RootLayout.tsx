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
  const triggerRef = useRef<HTMLElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  // Capture the trigger element on pointerdown, while the panel is not rendered.
  // This is more reliable than capturing in the open effect (focus may have moved by then).
  useEffect(() => {
    if (shouldRender) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      triggerRef.current = target instanceof HTMLElement ? target : null;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const el = document.activeElement;
        triggerRef.current = el instanceof HTMLElement ? el : null;
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [shouldRender]);

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      setShouldRender(open);
      setIsVisible(open);
      return;
    }

    if (open) {
      setShouldRender(true);
      let innerFrame = 0;
      const outerFrame = window.requestAnimationFrame(() => {
        setIsVisible(true);
        innerFrame = window.requestAnimationFrame(() => {
          closeBtnRef.current?.focus();
        });
      });
      return () => {
        window.cancelAnimationFrame(outerFrame);
        window.cancelAnimationFrame(innerFrame);
      };
    }

    setIsVisible(false);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const duration = reduceMotion.matches ? 0 : PANEL_TRANSITION_MS;
    const timeoutId = window.setTimeout(() => {
      triggerRef.current?.focus();
      triggerRef.current = null;
      setShouldRender(false);
    }, duration);
    return () => window.clearTimeout(timeoutId);
  }, [open]);

  if (!shouldRender) return null;

  return <TaskDetailPanel isOpen={isVisible} closeBtnRef={closeBtnRef} />;
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
    <div
      className="flex h-screen items-center justify-center bg-background"
      role="status"
      aria-label="Loading"
    >
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
