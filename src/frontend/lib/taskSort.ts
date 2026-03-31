export type SortPreference =
  | 'manual'
  | 'priority'
  | 'dueDate'
  | 'newest'
  | 'oldest';

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

export function sortTasks<
  T extends {
    position: number;
    priority?: string;
    dueAt?: number;
    createdAt: number;
  },
>(tasks: T[], sort: SortPreference): T[] {
  const sorted = [...tasks];
  sorted.sort((a, b) => {
    switch (sort) {
      case 'manual':
        return a.position - b.position;
      case 'priority': {
        const pa = PRIORITY_ORDER[a.priority ?? 'none'] ?? 0;
        const pb = PRIORITY_ORDER[b.priority ?? 'none'] ?? 0;
        if (pb !== pa) return pb - pa; // high to low
        return a.position - b.position; // tie-break by position
      }
      case 'dueDate': {
        const da = a.dueAt ?? Infinity;
        const db = b.dueAt ?? Infinity;
        if (da !== db) return da - db; // earliest first
        return a.position - b.position; // tie-break
      }
      case 'newest':
        return b.createdAt - a.createdAt;
      case 'oldest':
        return a.createdAt - b.createdAt;
      default:
        return 0;
    }
  });
  return sorted;
}
