import {
  AlertCircle,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  Clock,
  GitBranch,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';
import { useState } from 'react';
import Badge from '@/frontend/components/ui/Badge';
import Button from '@/frontend/components/ui/Button';
import { cn } from '@/frontend/lib/utils';
import type { AgentCard, QueueItem } from './types';

interface DecisionQueueProps {
  onFocusTask: () => void;
}

const INITIAL_QUEUE: QueueItem[] = [
  {
    id: 'q1',
    type: 'permission',
    taskName: 'Fix OAuth Redirect Loop',
    taskNumber: 42,
    sessionNumber: 3,
    command: 'bun run test src/server/auth.test.ts',
    contextLines: [
      '// Testing redirect callback with state param validation',
      '// Requires network access to localhost:3000 (dev server)',
    ],
    timeAgo: 'waiting 12s',
    effort: 'Low',
    waitingSeconds: 12,
  },
  {
    id: 'q2',
    type: 'completed',
    taskName: 'Add payment webhook',
    taskNumber: 38,
    timeAgo: '2 min ago',
    effort: 'Low',
  },
  {
    id: 'q3',
    type: 'review',
    taskName: 'Refactor user model',
    taskNumber: 45,
    timeAgo: '8 min ago',
    effort: 'High',
  },
  {
    id: 'q4',
    type: 'error',
    taskName: 'E2E test scaffold',
    taskNumber: 50,
    timeAgo: '14 min ago',
    effort: 'Medium',
  },
];

const AGENTS: AgentCard[] = [
  {
    id: 1,
    name: 'Agent 1',
    task: 'Add payment webhook (#38)',
    progress: 100,
    elapsed: '12m',
    cost: '$0.08',
    status: 'running',
  },
  {
    id: 2,
    name: 'Agent 2',
    task: 'Update CI pipeline (#41)',
    progress: 67,
    elapsed: '8m',
    cost: '$0.05',
    status: 'running',
  },
  {
    id: 3,
    name: 'Agent 3',
    task: 'Fix OAuth Redirect Loop (#42)',
    progress: 45,
    elapsed: '18m',
    cost: '$0.12',
    status: 'waiting',
  },
  {
    id: 4,
    name: 'Agent 4',
    task: 'Schema migration (#44)',
    progress: 23,
    elapsed: '3m',
    cost: '$0.02',
    status: 'running',
  },
  {
    id: 5,
    name: 'Agent 5',
    task: 'E2E test scaffold (#50)',
    progress: 12,
    elapsed: '14m',
    cost: '$0.09',
    status: 'stalled',
  },
];

const typeIcon: Record<QueueItem['type'], React.ReactNode> = {
  permission: <Terminal className="h-4 w-4 text-amber-500" />,
  completed: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  review: <GitBranch className="h-4 w-4 text-blue-400" />,
  error: <AlertCircle className="h-4 w-4 text-red-400" />,
};

const typeLabel: Record<QueueItem['type'], string> = {
  permission: 'Permission',
  completed: 'Task Completed',
  review: 'Code Review',
  error: 'Error Triage',
};

const effortColor: Record<QueueItem['effort'], string> = {
  Low: 'text-emerald-500',
  Medium: 'text-amber-500',
  High: 'text-red-400',
};

interface PermissionCardProps {
  item: QueueItem;
  onApprove: () => void;
  onDeny: () => void;
  onShowSession: () => void;
}

function PermissionCard({
  item,
  onApprove,
  onDeny,
  onShowSession,
}: PermissionCardProps) {
  return (
    <article
      className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 space-y-3"
      aria-label={`Permission request for ${item.taskName}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Badge className="shrink-0 border-amber-500/30 bg-amber-500/10 text-amber-500 text-[10px] px-1.5 py-0">
            Permission
          </Badge>
          <span className="text-sm font-medium text-foreground truncate">
            {item.taskName} (#{item.taskNumber}) · Session {item.sessionNumber}
          </span>
        </div>
      </div>

      {/* Command */}
      <div className="rounded-md bg-background/80 border border-border/50 px-3 py-2 font-mono text-xs text-foreground/90">
        {item.command}
      </div>

      {/* Context */}
      <div className="rounded-md bg-muted/30 border border-border/30 px-3 py-2 space-y-0.5">
        {item.contextLines?.map((line) => (
          <p
            key={line}
            className="text-xs text-muted-foreground font-mono leading-relaxed"
          >
            {line}
          </p>
        ))}
      </div>

      {/* Show full session link */}
      <button
        type="button"
        onClick={onShowSession}
        className="flex items-center gap-1 text-xs text-primary hover:underline cursor-pointer"
      >
        Show full session
        <ChevronRight className="h-3 w-3" />
      </button>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          onClick={onApprove}
          className="gap-1.5 bg-emerald-600 hover:bg-emerald-600/90 text-white"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Approve
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={onDeny}
          className="gap-1.5"
        >
          <X className="h-3.5 w-3.5" />
          Deny
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onApprove}
          className="gap-1.5 text-xs"
        >
          <CheckCheck className="h-3.5 w-3.5" />
          Approve All Bash
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1 text-xs text-amber-500">
            <Clock className="h-3 w-3" />
            {item.timeAgo}
          </div>
          <span className={cn('text-xs font-medium', effortColor[item.effort])}>
            {item.effort} effort
          </span>
        </div>
      </div>
    </article>
  );
}

interface CompactRowProps {
  item: QueueItem;
  onFocus?: () => void;
}

function CompactRow({ item, onFocus }: CompactRowProps) {
  return (
    <article
      className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/50 px-3 py-2.5 hover:bg-card transition-colors duration-150"
      aria-label={`${typeLabel[item.type]}: ${item.taskName}`}
    >
      <div className="shrink-0">{typeIcon[item.type]}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">
            {typeLabel[item.type]}
          </span>
          <span className="text-xs text-muted-foreground">—</span>
          <span className="text-sm font-medium truncate">
            {item.taskName} (#{item.taskNumber})
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-muted-foreground">{item.timeAgo}</span>
        <span className={cn('text-xs font-medium', effortColor[item.effort])}>
          {item.effort}
        </span>
        {item.type === 'review' && onFocus && (
          <Button
            size="sm"
            variant="outline"
            onClick={onFocus}
            className="text-xs h-7 px-2.5 gap-1"
          >
            <Sparkles className="h-3 w-3" />
            Focus
          </Button>
        )}
      </div>
    </article>
  );
}

function AgentSidebarCard({ agent }: { agent: AgentCard }) {
  return (
    <div
      className={cn(
        'rounded-lg border p-3 space-y-2 bg-card/80',
        agent.status === 'waiting' && 'border-amber-500/40',
        agent.status === 'stalled' && 'border-red-400/40',
        agent.status === 'running' && 'border-border/50',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-foreground">{agent.name}</p>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {agent.task}
          </p>
        </div>
        {agent.status === 'waiting' && (
          <span className="text-[10px] font-semibold text-amber-500 shrink-0">
            Waiting on you
          </span>
        )}
        {agent.status === 'stalled' && (
          <span className="text-[10px] font-semibold text-red-400 shrink-0">
            Stalled
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div
        className="h-1.5 rounded-full bg-muted overflow-hidden"
        role="progressbar"
        aria-valuenow={agent.progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${agent.name} progress`}
      >
        <div
          className={cn(
            'h-full rounded-full transition-all duration-300',
            agent.status === 'waiting' && 'bg-amber-500',
            agent.status === 'stalled' && 'bg-red-400',
            agent.status === 'running' && 'bg-primary',
          )}
          style={{ width: `${agent.progress}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {agent.progress}% · {agent.elapsed}
        </span>
        <span className="font-mono">{agent.cost}</span>
      </div>
    </div>
  );
}

export default function DecisionQueue({ onFocusTask }: DecisionQueueProps) {
  const [queueItems, setQueueItems] = useState<QueueItem[]>(INITIAL_QUEUE);

  const topItem = queueItems[0];
  const restItems = queueItems.slice(1);

  const handleApprove = () => {
    setQueueItems((prev) => prev.slice(1));
  };

  const handleDeny = () => {
    setQueueItems((prev) => prev.slice(1));
  };

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Header */}
        <div className="shrink-0 px-6 py-4 border-b border-border/50">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold">Decision Queue</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {queueItems.length > 0
                  ? `${queueItems.length} item${queueItems.length !== 1 ? 's' : ''} · Quick wins first`
                  : 'All clear'}
              </p>
            </div>
          </div>
        </div>

        {/* Queue items */}
        <ul
          className="flex-1 overflow-y-auto px-6 py-4 space-y-3 list-none"
          aria-label="Decision queue items"
        >
          {queueItems.length === 0 ? (
            <li className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <div className="rounded-full bg-emerald-500/10 p-4">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-foreground">
                  Nothing needs you right now
                </p>
                <p className="text-sm text-muted-foreground">
                  Your agents are humming along.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm">
                  Start a new task
                </Button>
                <Button variant="ghost" size="sm">
                  View kanban board
                </Button>
              </div>
            </li>
          ) : (
            <>
              {/* Top item expanded */}
              {topItem && (
                <li>
                  {topItem.type === 'permission' ? (
                    <PermissionCard
                      item={topItem}
                      onApprove={handleApprove}
                      onDeny={handleDeny}
                      onShowSession={onFocusTask}
                    />
                  ) : (
                    <CompactRow
                      item={topItem}
                      onFocus={
                        topItem.type === 'review' ? onFocusTask : undefined
                      }
                    />
                  )}
                </li>
              )}

              {/* Remaining items */}
              {restItems.map((item) => (
                <li key={item.id}>
                  <CompactRow
                    item={item}
                    onFocus={item.type === 'review' ? onFocusTask : undefined}
                  />
                </li>
              ))}
            </>
          )}
        </ul>
      </div>

      {/* Running agents sidebar */}
      <aside
        className="w-[300px] shrink-0 border-l border-border/50 flex flex-col min-h-0 overflow-hidden"
        aria-label="Running agents"
      >
        <div className="shrink-0 px-4 py-3 border-b border-border/50">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Running Agents</h2>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
              <span className="text-xs text-muted-foreground">5 active</span>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0">
          {AGENTS.map((agent) => (
            <AgentSidebarCard key={agent.id} agent={agent} />
          ))}
        </div>

        {/* Daily stats footer */}
        <div className="shrink-0 border-t border-border/50 px-4 py-3 bg-muted/20">
          <p className="text-xs text-muted-foreground font-medium mb-1">
            Today
          </p>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-foreground">
              <span className="font-semibold">12</span>{' '}
              <span className="text-muted-foreground">cleared</span>
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-foreground">
              <span className="font-semibold">3</span>{' '}
              <span className="text-muted-foreground">tasks done</span>
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="font-mono text-foreground font-semibold">
              $0.47
            </span>
          </div>
        </div>
      </aside>
    </div>
  );
}
