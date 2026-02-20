import { Authenticated, AuthLoading, Unauthenticated } from 'convex/react';
import { Loader2 } from 'lucide-react';
import { e2eTest } from '@/frontend/lib/config';
import { useAppStore } from '@/frontend/stores/app';
import { CommandPalette } from './components/CommandPalette';
import { KanbanBoard } from './components/KanbanBoard';
import { SeedBoard } from './components/SeedBoard';
import { Sidebar } from './components/Sidebar';
import SignInPage from './components/SignInPage';
import { TaskDetailPanel } from './components/TaskDetailPanel';
import TaskPageView from './components/TaskPageView';

function AuthenticatedApp() {
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const viewMode = useAppStore((s) => s.viewMode);
  const taskPageFocusMode = useAppStore((s) => s.taskPageFocusMode);
  const showTaskPage = viewMode === 'task-page';
  const hideSidebar = showTaskPage && taskPageFocusMode;

  return (
    <div className="flex h-screen bg-background text-foreground relative">
      {!hideSidebar && <Sidebar />}
      <main className="flex-1 flex flex-col overflow-hidden">
        {showTaskPage ? (
          <TaskPageView />
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
