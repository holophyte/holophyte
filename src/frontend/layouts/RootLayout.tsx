import { Outlet, useLocation, useMatch } from '@tanstack/react-router';
import { Authenticated, AuthLoading, Unauthenticated } from 'convex/react';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { Toaster } from 'sonner';
import { useTheme } from '@/frontend/hooks/useTheme';
import { allowPasswordAuth, e2eTest } from '@/frontend/lib/config';
import { LIGHT_THEMES, useAppStore } from '@/frontend/stores/app';
import AutoTestAuth from '../components/AutoTestAuth';
import { CommandPalette } from '../components/CommandPalette';
import { Sidebar } from '../components/Sidebar';
import SignInPage from '../components/SignInPage';
import TaskDetailPanel from '../components/TaskDetailPanel';
import ErrorFallback from '../components/ui/ErrorFallback';
import RootErrorFallback from '../components/ui/RootErrorFallback';

const PANEL_TRANSITION_MS = 300;

function logError(error: unknown, info: { componentStack?: string | null }) {
  console.error('ErrorBoundary caught:', error, info.componentStack);
}

function AnimatedTaskDetailPanel({
  open,
  taskId,
  skipFocusRestore,
}: {
  open: boolean;
  taskId?: string;
  skipFocusRestore: boolean;
}) {
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

  // Keep triggerRef in sync when the user switches task cards while the panel is already open.
  useEffect(() => {
    if (!shouldRender || !taskId) return;
    const card = document.querySelector(`[data-task-id="${taskId}"]`);
    if (card instanceof HTMLElement) {
      triggerRef.current = card;
    }
  }, [taskId, shouldRender]);

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      setShouldRender(open);
      setIsVisible(open);
      if (open) {
        const innerFrame = window.requestAnimationFrame(() => {
          closeBtnRef.current?.focus();
        });
        return () => window.cancelAnimationFrame(innerFrame);
      }
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
      if (!skipFocusRestore) {
        triggerRef.current?.focus();
      }
      triggerRef.current = null;
      setShouldRender(false);
    }, duration);
    return () => window.clearTimeout(timeoutId);
  }, [open, skipFocusRestore]);

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
  // Don't restore focus when closing due to "Expand to full page" navigation
  const skipFocusRestore = !!taskPageMatch;
  const taskId = taskDetailMatch?.params.taskId;
  const { pathname } = useLocation();

  return (
    <div className="flex h-screen bg-background text-foreground relative">
      <ErrorBoundary
        fallbackRender={(props) => (
          <aside className="shrink-0 w-64 border-r bg-muted/30 h-full">
            <ErrorFallback {...props} />
          </aside>
        )}
        onError={logError}
      >
        <Sidebar />
      </ErrorBoundary>
      <main className="relative flex-1 min-w-0 flex flex-col overflow-clip">
        <ErrorBoundary
          FallbackComponent={ErrorFallback}
          onError={logError}
          resetKeys={[pathname]}
        >
          <Outlet />
        </ErrorBoundary>
        <ErrorBoundary
          fallbackRender={(props) => (
            <div className="absolute right-0 top-0 bottom-0 z-10 w-96 border-l bg-background">
              <ErrorFallback {...props} />
            </div>
          )}
          onError={logError}
          resetKeys={[taskId]}
        >
          <AnimatedTaskDetailPanel
            open={showTaskDetailPanel}
            taskId={taskId}
            skipFocusRestore={skipFocusRestore}
          />
        </ErrorBoundary>
      </main>
      <CommandPalette />
    </div>
  );
}

export default function RootLayout() {
  useTheme();
  const theme = useAppStore((s) => s.theme);
  const sonnerTheme = LIGHT_THEMES.has(theme) ? 'light' : 'dark';
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
      <Toaster theme={sonnerTheme} position="top-center" closeButton />
      {allowPasswordAuth && !hasSigninQuery && <AutoTestAuth />}
      <AuthLoading>{spinner}</AuthLoading>
      <Unauthenticated>
        {e2eTest && !allowPasswordAuth ? spinner : <SignInPage />}
      </Unauthenticated>
      <Authenticated>
        <ErrorBoundary FallbackComponent={RootErrorFallback} onError={logError}>
          <AuthenticatedLayout />
        </ErrorBoundary>
      </Authenticated>
    </>
  );
}
