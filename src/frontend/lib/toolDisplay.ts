import {
  FileEdit,
  FileSearch,
  FileText,
  Globe,
  ListTodo,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react';
import type { ReactElement } from 'react';
import { createElement } from 'react';

/**
 * Returns a lucide icon element for the given Claude tool name.
 * Falls back to a generic wrench icon for unknown tools.
 */
export function toolIcon(name: string): ReactElement {
  switch (name) {
    case 'Read':
      return createElement(FileText, { className: 'h-3.5 w-3.5' });
    case 'Edit':
    case 'Write':
      return createElement(FileEdit, { className: 'h-3.5 w-3.5' });
    case 'Bash':
      return createElement(Terminal, { className: 'h-3.5 w-3.5' });
    case 'Grep':
      return createElement(Search, { className: 'h-3.5 w-3.5' });
    case 'Glob':
      return createElement(FileSearch, { className: 'h-3.5 w-3.5' });
    case 'WebFetch':
    case 'WebSearch':
      return createElement(Globe, { className: 'h-3.5 w-3.5' });
    case 'TaskCreate':
    case 'TaskUpdate':
    case 'TaskGet':
    case 'TaskList':
      return createElement(ListTodo, { className: 'h-3.5 w-3.5' });
    default:
      return createElement(Wrench, { className: 'h-3.5 w-3.5' });
  }
}

/**
 * Returns a short human-readable summary string for a tool call.
 * Extracts the most relevant input field (e.g. file path, command) per tool.
 */
export function toolSummary(
  name: string,
  input: Record<string, unknown>,
): string {
  switch (name) {
    case 'Read': {
      const path = typeof input.file_path === 'string' ? input.file_path : '';
      return path || 'Read file';
    }
    case 'Edit': {
      const path = typeof input.file_path === 'string' ? input.file_path : '';
      return path || 'Edit file';
    }
    case 'Write': {
      const path = typeof input.file_path === 'string' ? input.file_path : '';
      return path || 'Write file';
    }
    case 'Bash': {
      const cmd = typeof input.command === 'string' ? input.command : '';
      return cmd.length > 80 ? `${cmd.slice(0, 80)}…` : cmd || 'bash command';
    }
    case 'Grep': {
      const pattern = typeof input.pattern === 'string' ? input.pattern : '';
      const path = typeof input.path === 'string' ? ` in ${input.path}` : '';
      return `${pattern}${path}` || 'Search';
    }
    case 'Glob': {
      const pattern = typeof input.pattern === 'string' ? input.pattern : '';
      return pattern || 'Glob pattern';
    }
    case 'WebFetch':
    case 'WebSearch': {
      const url =
        typeof input.url === 'string'
          ? input.url
          : typeof input.query === 'string'
            ? input.query
            : '';
      return url.length > 80 ? `${url.slice(0, 80)}…` : url || name;
    }
    case 'TaskCreate': {
      const subject = typeof input.subject === 'string' ? input.subject : '';
      if (!subject) return 'Create task';
      return subject.length > 80 ? `${subject.slice(0, 80)}…` : subject;
    }
    case 'TaskUpdate': {
      const taskId = typeof input.taskId === 'string' ? input.taskId : '';
      return taskId ? `Update task ${taskId}` : 'Update task';
    }
    case 'TaskGet': {
      const taskId = typeof input.taskId === 'string' ? input.taskId : '';
      return taskId ? `Get task ${taskId}` : 'Get task';
    }
    case 'TaskList':
      return 'List tasks';
    default:
      return JSON.stringify(input).slice(0, 80);
  }
}
