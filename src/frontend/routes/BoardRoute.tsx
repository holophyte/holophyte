import { Outlet } from '@tanstack/react-router';
import { KanbanBoard } from '../components/KanbanBoard';

export default function BoardRoute() {
  return (
    <>
      <KanbanBoard />
      <Outlet />
    </>
  );
}
