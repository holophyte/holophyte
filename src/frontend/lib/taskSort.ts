import type { SortPreference } from '@convex/schema';

export type { SortPreference };

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

export function sortTasks<
  T extends {
    _id: string;
    position: number;
    priority?: string;
    dueAt?: number;
    createdAt: number;
  },
>(tasks: T[], sort: SortPreference, sortOrder?: string[]): T[] {
  const sorted = [...tasks];

  if (sort === 'auto') {
    if (!sortOrder) return sorted;
    const indexMap = new Map(sortOrder.map((id, i) => [id, i]));
    return sorted.sort((a, b) => {
      const ai = indexMap.get(a._id) ?? Number.MAX_SAFE_INTEGER;
      const bi = indexMap.get(b._id) ?? Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a.position - b.position;
    });
  }

  sorted.sort((a, b) => {
    switch (sort) {
      case 'manual':
        return a.position - b.position;
      case 'priority': {
        // Unknown priorities sort last (0) — same as 'none'
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
      case 'newest': {
        const diff = b.createdAt - a.createdAt;
        return diff !== 0 ? diff : a.position - b.position;
      }
      case 'oldest': {
        const diff = a.createdAt - b.createdAt;
        return diff !== 0 ? diff : a.position - b.position;
      }
      default:
        return 0;
    }
  });
  return sorted;
}
