import { useEffect } from 'react';
import { useAppStore } from '@/frontend/stores/app';
import { CommandPalette } from './components/CommandPalette';
import FocusMode from './components/FocusMode';
import { KanbanBoard } from './components/KanbanBoard';
import { SeedBoard } from './components/SeedBoard';
import { Sidebar } from './components/Sidebar';
import { TaskDetailPanel } from './components/TaskDetailPanel';
import { TerminalPanel } from './components/TerminalPanel';

export function App() {
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const terminalSessionId = useAppStore((s) => s.terminalSessionId);
  const viewMode = useAppStore((s) => s.viewMode);
  const focusMode = useAppStore((s) => s.focusMode);
  const enterFocusMode = useAppStore((s) => s.enterFocusMode);
  const exitFocusMode = useAppStore((s) => s.exitFocusMode);

  // Keyboard shortcuts for focus mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape exits focus mode
      if (e.key === 'Escape' && focusMode) {
        e.preventDefault();
        exitFocusMode();
        return;
      }

      // Cmd/Ctrl+Shift+F toggles focus mode
      if (e.key === 'f' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        const tag = (e.target as HTMLElement).tagName;
        const isEditable =
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          (e.target as HTMLElement).isContentEditable;
        if (isEditable) return;

        e.preventDefault();
        if (focusMode) {
          exitFocusMode();
        } else {
          enterFocusMode();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [focusMode, enterFocusMode, exitFocusMode]);

  // Exit focus mode if the task is deselected
  useEffect(() => {
    if (focusMode && !selectedTaskId) {
      exitFocusMode();
    }
  }, [focusMode, selectedTaskId, exitFocusMode]);

  if (focusMode && selectedTaskId) {
    return (
      <div className="flex h-screen bg-background text-foreground">
        <FocusMode />
        <CommandPalette />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background text-foreground relative">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:text-sm focus:font-medium"
      >
        Skip to main content
      </a>
      <Sidebar />
      <main id="main-content" className="flex-1 flex flex-col overflow-hidden">
        {viewMode === 'seeds' ? <SeedBoard /> : <KanbanBoard />}
        {terminalSessionId && <TerminalPanel />}
      </main>
      {selectedTaskId && <TaskDetailPanel />}
      <CommandPalette />
    </div>
  );
}
