import { Authenticated, AuthLoading, Unauthenticated } from 'convex/react';
import { Loader2 } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { useCustomThemes } from '@/frontend/hooks/useCustomThemes';
import { useTheme } from '@/frontend/hooks/useTheme';
import { e2eTest } from '@/frontend/lib/config';
import { useAppStore } from '@/frontend/stores/app';
import { CommandPalette } from './components/CommandPalette';
import { KanbanBoard } from './components/KanbanBoard';
import { SeedBoard } from './components/SeedBoard';
import { Sidebar } from './components/Sidebar';
import SignInPage from './components/SignInPage';
import { TaskDetailPanel } from './components/TaskDetailPanel';
import TaskPageView from './components/TaskPageView';

const ThemeCreatorPage = lazy(() => import('./components/ThemeCreatorPage'));

function AuthenticatedApp() {
  useCustomThemes();
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const viewMode = useAppStore((s) => s.viewMode);
  const showTaskPage = viewMode === 'task-page';

  return (
    <div className="flex h-screen bg-background text-foreground relative">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        {showTaskPage ? (
          <TaskPageView />
        ) : viewMode === 'theme-creator' ? (
          <Suspense
            fallback={
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="h-8 w-8 motion-safe:animate-spin text-muted-foreground" />
              </div>
            }
          >
            <ThemeCreatorPage />
          </Suspense>
        ) : viewMode === 'seeds' ? (
          <SeedBoard />
        ) : (
          <KanbanBoard />
        )}
      </main>
      {!showTaskPage && selectedTaskId && <TaskDetailPanel />}
      <CommandPalette />
    </div>
  );
}

export function App() {
  useTheme();

  // In E2E test mode, skip auth gates — render the app directly
  if (e2eTest) return <AuthenticatedApp />;

  return (
    <>
      <AuthLoading>
        <div className="flex h-screen items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 motion-safe:animate-spin text-muted-foreground" />
        </div>
      </AuthLoading>
      <Unauthenticated>
        <SignInPage />
      </Unauthenticated>
      <Authenticated>
        <AuthenticatedApp />
      </Authenticated>
    </>
  );
}
