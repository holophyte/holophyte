// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { sortTasks } from './taskSort';

// Minimal task shape for testing
interface TestTask {
  id: string;
  position: number;
  priority?: string;
  dueAt?: number;
  createdAt: number;
}

function makeTask(overrides: Partial<TestTask> & { id: string }): TestTask {
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
        makeTask({ id: 'a', position: 3 }),
        makeTask({ id: 'b', position: 1 }),
        makeTask({ id: 'c', position: 2 }),
      ];
      const result = sortTasks(tasks, 'manual');
      expect(result.map((t) => t.id)).toEqual(['b', 'c', 'a']);
    });

    it('does not mutate the input array', () => {
      const tasks = [
        makeTask({ id: 'a', position: 2 }),
        makeTask({ id: 'b', position: 1 }),
      ];
      const original = [...tasks];
      sortTasks(tasks, 'manual');
      expect(tasks).toEqual(original);
    });
  });

  describe('priority', () => {
    it('sorts by priority descending (urgent first)', () => {
      const tasks = [
        makeTask({ id: 'low', position: 1, priority: 'low' }),
        makeTask({ id: 'urgent', position: 2, priority: 'urgent' }),
        makeTask({ id: 'medium', position: 3, priority: 'medium' }),
        makeTask({ id: 'high', position: 4, priority: 'high' }),
      ];
      const result = sortTasks(tasks, 'priority');
      expect(result.map((t) => t.id)).toEqual([
        'urgent',
        'high',
        'medium',
        'low',
      ]);
    });

    it('treats missing priority as none (sorts last)', () => {
      const tasks = [
        makeTask({ id: 'nopriority', position: 1 }),
        makeTask({ id: 'low', position: 2, priority: 'low' }),
        makeTask({ id: 'none', position: 3, priority: 'none' }),
      ];
      const result = sortTasks(tasks, 'priority');
      expect(result.map((t) => t.id)).toEqual(['low', 'nopriority', 'none']);
    });

    it('tie-breaks equal priority by position ascending', () => {
      const tasks = [
        makeTask({ id: 'a', position: 3, priority: 'high' }),
        makeTask({ id: 'b', position: 1, priority: 'high' }),
        makeTask({ id: 'c', position: 2, priority: 'high' }),
      ];
      const result = sortTasks(tasks, 'priority');
      expect(result.map((t) => t.id)).toEqual(['b', 'c', 'a']);
    });

    it('does not mutate the input array', () => {
      const tasks = [
        makeTask({ id: 'a', position: 1, priority: 'high' }),
        makeTask({ id: 'b', position: 2, priority: 'low' }),
      ];
      const original = [...tasks];
      sortTasks(tasks, 'priority');
      expect(tasks).toEqual(original);
    });
  });

  describe('dueDate', () => {
    it('sorts by dueAt ascending (earliest first)', () => {
      const tasks = [
        makeTask({ id: 'c', position: 1, dueAt: 3000 }),
        makeTask({ id: 'a', position: 2, dueAt: 1000 }),
        makeTask({ id: 'b', position: 3, dueAt: 2000 }),
      ];
      const result = sortTasks(tasks, 'dueDate');
      expect(result.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    });

    it('tasks with missing dueAt sort last', () => {
      const tasks = [
        makeTask({ id: 'noduedate', position: 1 }),
        makeTask({ id: 'future', position: 2, dueAt: 9999 }),
        makeTask({ id: 'soon', position: 3, dueAt: 1000 }),
      ];
      const result = sortTasks(tasks, 'dueDate');
      expect(result.map((t) => t.id)).toEqual(['soon', 'future', 'noduedate']);
    });

    it('multiple tasks with missing dueAt tie-break by position', () => {
      const tasks = [
        makeTask({ id: 'a', position: 3 }),
        makeTask({ id: 'b', position: 1 }),
        makeTask({ id: 'c', position: 2 }),
      ];
      const result = sortTasks(tasks, 'dueDate');
      expect(result.map((t) => t.id)).toEqual(['b', 'c', 'a']);
    });

    it('tie-breaks equal dueAt by position ascending', () => {
      const tasks = [
        makeTask({ id: 'a', position: 3, dueAt: 1000 }),
        makeTask({ id: 'b', position: 1, dueAt: 1000 }),
        makeTask({ id: 'c', position: 2, dueAt: 1000 }),
      ];
      const result = sortTasks(tasks, 'dueDate');
      expect(result.map((t) => t.id)).toEqual(['b', 'c', 'a']);
    });

    it('does not mutate the input array', () => {
      const tasks = [
        makeTask({ id: 'a', position: 1, dueAt: 2000 }),
        makeTask({ id: 'b', position: 2, dueAt: 1000 }),
      ];
      const original = [...tasks];
      sortTasks(tasks, 'dueDate');
      expect(tasks).toEqual(original);
    });
  });

  describe('newest', () => {
    it('sorts by createdAt descending (newest first)', () => {
      const tasks = [
        makeTask({ id: 'old', position: 1, createdAt: 1000 }),
        makeTask({ id: 'new', position: 2, createdAt: 3000 }),
        makeTask({ id: 'mid', position: 3, createdAt: 2000 }),
      ];
      const result = sortTasks(tasks, 'newest');
      expect(result.map((t) => t.id)).toEqual(['new', 'mid', 'old']);
    });

    it('does not mutate the input array', () => {
      const tasks = [
        makeTask({ id: 'a', position: 1, createdAt: 1000 }),
        makeTask({ id: 'b', position: 2, createdAt: 2000 }),
      ];
      const original = [...tasks];
      sortTasks(tasks, 'newest');
      expect(tasks).toEqual(original);
    });
  });

  describe('oldest', () => {
    it('sorts by createdAt ascending (oldest first)', () => {
      const tasks = [
        makeTask({ id: 'old', position: 1, createdAt: 1000 }),
        makeTask({ id: 'new', position: 2, createdAt: 3000 }),
        makeTask({ id: 'mid', position: 3, createdAt: 2000 }),
      ];
      const result = sortTasks(tasks, 'oldest');
      expect(result.map((t) => t.id)).toEqual(['old', 'mid', 'new']);
    });

    it('does not mutate the input array', () => {
      const tasks = [
        makeTask({ id: 'a', position: 1, createdAt: 2000 }),
        makeTask({ id: 'b', position: 2, createdAt: 1000 }),
      ];
      const original = [...tasks];
      sortTasks(tasks, 'oldest');
      expect(tasks).toEqual(original);
    });
  });
});
