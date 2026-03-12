export type MockupView = 'queue' | 'focus';

export interface QueueItem {
  id: string;
  type: 'permission' | 'completed' | 'review' | 'error';
  taskName: string;
  taskNumber: number;
  sessionNumber?: number;
  command?: string;
  contextLines?: string[];
  timeAgo: string;
  effort: 'Low' | 'Medium' | 'High';
  waitingSeconds?: number;
}

export interface AgentCard {
  id: number;
  name: string;
  task: string;
  progress: number;
  elapsed: string;
  cost: string;
  status: 'running' | 'waiting' | 'stalled';
}
