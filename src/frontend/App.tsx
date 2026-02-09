import { Sidebar } from "./components/Sidebar";
import { KanbanBoard } from "./components/KanbanBoard";
import { TaskDetailPanel } from "./components/TaskDetailPanel";
import { TerminalPanel } from "./components/TerminalPanel";
import { useAppStore } from "@/frontend/stores/app";

export function App() {
  const selectedRepoId = useAppStore((s) => s.selectedRepoId);
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const terminalSessionId = useAppStore((s) => s.terminalSessionId);

  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <KanbanBoard />
        {terminalSessionId && <TerminalPanel />}
      </main>
      {selectedTaskId && <TaskDetailPanel />}
    </div>
  );
}
