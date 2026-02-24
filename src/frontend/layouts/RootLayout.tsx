import { Outlet, useMatch } from '@tanstack/react-router';
import { Authenticated, AuthLoading, Unauthenticated } from 'convex/react';
import { Loader2 } from 'lucide-react';
import { useTheme } from '@/frontend/hooks/useTheme';
import { e2eTest } from '@/frontend/lib/config';
import AutoAnonymousAuth from '../components/AutoAnonymousAuth';
import { CommandPalette } from '../components/CommandPalette';
import { Sidebar } from '../components/Sidebar';
import SignInPage from '../components/SignInPage';
import { TaskDetailPanel } from '../components/TaskDetailPanel';

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
      <main className="flex-1 flex flex-col overflow-hidden">
        <Outlet />
      </main>
      {showTaskDetailPanel && <TaskDetailPanel />}
      <CommandPalette />
    </div>
  );
}

export default function RootLayout() {
  useTheme();

  const spinner = (
    <div className="flex h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 motion-safe:animate-spin text-muted-foreground" />
    </div>
  );

  return (
    <>
      {e2eTest && <AutoAnonymousAuth />}
      <AuthLoading>{spinner}</AuthLoading>
      <Unauthenticated>{e2eTest ? spinner : <SignInPage />}</Unauthenticated>
      <Authenticated>
        <AuthenticatedLayout />
      </Authenticated>
    </>
  );
}
