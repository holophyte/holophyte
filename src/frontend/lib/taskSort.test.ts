// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { sortTasks } from './taskSort';

// Minimal task shape for testing
interface TestTask {
  _id: string;
  position: number;
  priority?: string;
  dueAt?: number;
  createdAt: number;
}

function makeTask(overrides: Partial<TestTask> & { _id: string }): TestTask {
  return {
    position: 0,
    createdAt: 1000,
    ...overrides,
  };
}

describe('sortTasks', () => {
  describe('manual', () => {
    it('sorts by position ascending', () => {
      const tasks = [
        makeTask({ _id: 'a', position: 3 }),
        makeTask({ _id: 'b', position: 1 }),
        makeTask({ _id: 'c', position: 2 }),
      ];
      const result = sortTasks(tasks, 'manual');
      expect(result.map((t) => t._id)).toEqual(['b', 'c', 'a']);
    });

    it('does not mutate the input array', () => {
      const tasks = [
        makeTask({ _id: 'a', position: 2 }),
        makeTask({ _id: 'b', position: 1 }),
      ];
      const original = [...tasks];
      sortTasks(tasks, 'manual');
      expect(tasks).toEqual(original);
    });
  });

  describe('priority', () => {
    it('sorts by priority descending (urgent first)', () => {
      const tasks = [
        makeTask({ _id: 'low', position: 1, priority: 'low' }),
        makeTask({ _id: 'urgent', position: 2, priority: 'urgent' }),
        makeTask({ _id: 'medium', position: 3, priority: 'medium' }),
        makeTask({ _id: 'high', position: 4, priority: 'high' }),
      ];
      const result = sortTasks(tasks, 'priority');
      expect(result.map((t) => t._id)).toEqual([
        'urgent',
        'high',
        'medium',
        'low',
      ]);
    });

    it('treats missing priority as none (sorts last)', () => {
      const tasks = [
        makeTask({ _id: 'nopriority', position: 1 }),
        makeTask({ _id: 'low', position: 2, priority: 'low' }),
        makeTask({ _id: 'none', position: 3, priority: 'none' }),
      ];
      const result = sortTasks(tasks, 'priority');
      expect(result.map((t) => t._id)).toEqual(['low', 'nopriority', 'none']);
    });

    it('tie-breaks equal priority by position ascending', () => {
      const tasks = [
        makeTask({ _id: 'a', position: 3, priority: 'high' }),
        makeTask({ _id: 'b', position: 1, priority: 'high' }),
        makeTask({ _id: 'c', position: 2, priority: 'high' }),
      ];
      const result = sortTasks(tasks, 'priority');
      expect(result.map((t) => t._id)).toEqual(['b', 'c', 'a']);
    });

    it('does not mutate the input array', () => {
      const tasks = [
        makeTask({ _id: 'a', position: 1, priority: 'high' }),
        makeTask({ _id: 'b', position: 2, priority: 'low' }),
      ];
      const original = [...tasks];
      sortTasks(tasks, 'priority');
      expect(tasks).toEqual(original);
    });
  });

  describe('dueDate', () => {
    it('sorts by dueAt ascending (earliest first)', () => {
      const tasks = [
        makeTask({ _id: 'c', position: 1, dueAt: 3000 }),
        makeTask({ _id: 'a', position: 2, dueAt: 1000 }),
        makeTask({ _id: 'b', position: 3, dueAt: 2000 }),
      ];
      const result = sortTasks(tasks, 'dueDate');
      expect(result.map((t) => t._id)).toEqual(['a', 'b', 'c']);
    });

    it('tasks with missing dueAt sort last', () => {
      const tasks = [
        makeTask({ _id: 'noduedate', position: 1 }),
        makeTask({ _id: 'future', position: 2, dueAt: 9999 }),
        makeTask({ _id: 'soon', position: 3, dueAt: 1000 }),
      ];
      const result = sortTasks(tasks, 'dueDate');
      expect(result.map((t) => t._id)).toEqual(['soon', 'future', 'noduedate']);
    });

    it('multiple tasks with missing dueAt tie-break by position', () => {
      const tasks = [
        makeTask({ _id: 'a', position: 3 }),
        makeTask({ _id: 'b', position: 1 }),
        makeTask({ _id: 'c', position: 2 }),
      ];
      const result = sortTasks(tasks, 'dueDate');
      expect(result.map((t) => t._id)).toEqual(['b', 'c', 'a']);
    });

    it('tie-breaks equal dueAt by position ascending', () => {
      const tasks = [
        makeTask({ _id: 'a', position: 3, dueAt: 1000 }),
        makeTask({ _id: 'b', position: 1, dueAt: 1000 }),
        makeTask({ _id: 'c', position: 2, dueAt: 1000 }),
      ];
      const result = sortTasks(tasks, 'dueDate');
      expect(result.map((t) => t._id)).toEqual(['b', 'c', 'a']);
    });

    it('does not mutate the input array', () => {
      const tasks = [
        makeTask({ _id: 'a', position: 1, dueAt: 2000 }),
        makeTask({ _id: 'b', position: 2, dueAt: 1000 }),
      ];
      const original = [...tasks];
      sortTasks(tasks, 'dueDate');
      expect(tasks).toEqual(original);
    });
  });

  describe('newest', () => {
    it('sorts by createdAt descending (newest first)', () => {
      const tasks = [
        makeTask({ _id: 'old', position: 1, createdAt: 1000 }),
        makeTask({ _id: 'new', position: 2, createdAt: 3000 }),
        makeTask({ _id: 'mid', position: 3, createdAt: 2000 }),
      ];
      const result = sortTasks(tasks, 'newest');
      expect(result.map((t) => t._id)).toEqual(['new', 'mid', 'old']);
    });

    it('does not mutate the input array', () => {
      const tasks = [
        makeTask({ _id: 'a', position: 1, createdAt: 1000 }),
        makeTask({ _id: 'b', position: 2, createdAt: 2000 }),
      ];
      const original = [...tasks];
      sortTasks(tasks, 'newest');
      expect(tasks).toEqual(original);
    });
  });

  describe('oldest', () => {
    it('sorts by createdAt ascending (oldest first)', () => {
      const tasks = [
        makeTask({ _id: 'old', position: 1, createdAt: 1000 }),
        makeTask({ _id: 'new', position: 2, createdAt: 3000 }),
        makeTask({ _id: 'mid', position: 3, createdAt: 2000 }),
      ];
      const result = sortTasks(tasks, 'oldest');
      expect(result.map((t) => t._id)).toEqual(['old', 'mid', 'new']);
    });

    it('does not mutate the input array', () => {
      const tasks = [
        makeTask({ _id: 'a', position: 1, createdAt: 2000 }),
        makeTask({ _id: 'b', position: 2, createdAt: 1000 }),
      ];
      const original = [...tasks];
      sortTasks(tasks, 'oldest');
      expect(tasks).toEqual(original);
    });
  });

  describe('auto', () => {
    it('returns unsorted when no sortOrder provided', () => {
      const tasks = [
        makeTask({ _id: 'c', position: 1 }),
        makeTask({ _id: 'a', position: 2 }),
        makeTask({ _id: 'b', position: 3 }),
      ];
      const result = sortTasks(tasks, 'auto');
      expect(result.map((t) => t._id)).toEqual(['c', 'a', 'b']);
    });

    it('sorts by sortOrder index', () => {
      const tasks = [
        makeTask({ _id: 'c', position: 1 }),
        makeTask({ _id: 'a', position: 2 }),
        makeTask({ _id: 'b', position: 3 }),
      ];
      const result = sortTasks(tasks, 'auto', ['a', 'b', 'c']);
      expect(result.map((t) => t._id)).toEqual(['a', 'b', 'c']);
    });

    it('tasks not in sortOrder fall to end, ordered by position', () => {
      const tasks = [
        makeTask({ _id: 'x', position: 3 }),
        makeTask({ _id: 'a', position: 2 }),
        makeTask({ _id: 'y', position: 1 }),
        makeTask({ _id: 'b', position: 4 }),
      ];
      const result = sortTasks(tasks, 'auto', ['a', 'b']);
      expect(result.map((t) => t._id)).toEqual(['a', 'b', 'y', 'x']);
    });

    it('empty sortOrder returns tasks in original order', () => {
      const tasks = [
        makeTask({ _id: 'c', position: 1 }),
        makeTask({ _id: 'a', position: 2 }),
        makeTask({ _id: 'b', position: 3 }),
      ];
      const result = sortTasks(tasks, 'auto', []);
      expect(result.map((t) => t._id)).toEqual(['c', 'a', 'b']);
    });

    it('does not mutate the input array', () => {
      const tasks = [
        makeTask({ _id: 'b', position: 1 }),
        makeTask({ _id: 'a', position: 2 }),
      ];
      const original = [...tasks];
      sortTasks(tasks, 'auto', ['a', 'b']);
      expect(tasks).toEqual(original);
    });
  });
});
