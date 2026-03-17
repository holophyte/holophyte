import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { ClipboardList, FolderGit2, Sprout, Tag } from 'lucide-react';
import type React from 'react';
import { cn } from '@/frontend/lib/utils';
import { useAppStore } from '@/frontend/stores/app';
import ScrollArea from './ui/ScrollArea';
import Skeleton from './ui/Skeleton';

type EntityType = 'task' | 'seed' | 'label' | 'repo';

interface ActivityEntry {
  _id: string;
  orgId: string;
  userId: string;
  userName: string;
  action: string;
  entityType: EntityType;
  entityId: string;
  metadata?: string;
  createdAt: number;
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function parseMetadata(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function describeAction(
  action: string,
  metadata: Record<string, unknown>,
): string {
  switch (action) {
    case 'task.created':
      return 'created a task';
    case 'task.moved': {
      const from = typeof metadata.from === 'string' ? metadata.from : '?';
      const to = typeof metadata.to === 'string' ? metadata.to : '?';
      return `moved a task from ${from} to ${to}`;
    }
    case 'task.archived': {
      const title =
        typeof metadata.title === 'string' ? metadata.title : 'a task';
      return `archived task ${title}`;
    }
    case 'task.unarchived': {
      const title =
        typeof metadata.title === 'string' ? metadata.title : 'a task';
      return `unarchived task ${title}`;
    }
    case 'task.deleted': {
      const title =
        typeof metadata.title === 'string' ? metadata.title : 'a task';
      return `deleted task ${title}`;
    }
    case 'task.updated': {
      const fields = Array.isArray(metadata.fields)
        ? (metadata.fields as string[]).join(', ')
        : 'fields';
      return `updated task fields: ${fields}`;
    }
    case 'task.labels_changed':
      return 'changed labels on a task';
    case 'task.bulk_moved': {
      const count = typeof metadata.count === 'number' ? metadata.count : '?';
      const from = typeof metadata.from === 'string' ? metadata.from : '?';
      const to = typeof metadata.to === 'string' ? metadata.to : '?';
      return `bulk moved ${count} tasks from ${from} to ${to}`;
    }
    case 'task.bulk_deleted': {
      const count = typeof metadata.count === 'number' ? metadata.count : '?';
      return `bulk deleted ${count} tasks`;
    }
    case 'task.all_done_archived': {
      const count = typeof metadata.count === 'number' ? metadata.count : '?';
      return `archived ${count} done tasks`;
    }
    case 'seed.created': {
      const title =
        typeof metadata.title === 'string' ? metadata.title : 'a seed';
      return `created seed ${title}`;
    }
    case 'seed.planted':
      return 'planted a seed';
    case 'seed.deleted': {
      const title =
        typeof metadata.title === 'string' ? metadata.title : 'a seed';
      return `deleted seed ${title}`;
    }
    case 'label.created': {
      const name =
        typeof metadata.name === 'string' ? metadata.name : 'a label';
      return `created label ${name}`;
    }
    case 'label.updated': {
      const fields = Array.isArray(metadata.fields)
        ? (metadata.fields as string[]).join(', ')
        : 'fields';
      return `updated label fields: ${fields}`;
    }
    case 'label.deleted': {
      const name =
        typeof metadata.name === 'string' ? metadata.name : 'a label';
      return `deleted label ${name}`;
    }
    case 'repo.created': {
      const name =
        typeof metadata.name === 'string' ? metadata.name : 'a project';
      return `created project ${name}`;
    }
    case 'repo.deleted': {
      const name =
        typeof metadata.name === 'string' ? metadata.name : 'a project';
      return `deleted project ${name}`;
    }
    default:
      return action;
  }
}

const ENTITY_ICONS: Record<
  EntityType,
  React.ComponentType<{ className?: string }>
> = {
  task: ClipboardList,
  seed: Sprout,
  label: Tag,
  repo: FolderGit2,
};

function ActivityItem({ entry }: { entry: ActivityEntry }) {
  const metadata = parseMetadata(entry.metadata);
  const description = describeAction(entry.action, metadata);
  const Icon = ENTITY_ICONS[entry.entityType] ?? ClipboardList;

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border last:border-0">
      <div className="mt-0.5 shrink-0 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug">
          <span className="font-medium text-foreground">{entry.userName}</span>{' '}
          <span className="text-muted-foreground">{description}</span>
        </p>
      </div>
      <span
        className={cn(
          'text-xs text-muted-foreground shrink-0 mt-0.5 tabular-nums',
        )}
      >
        {formatRelativeTime(entry.createdAt)}
      </span>
    </div>
  );
}

function ActivityLogSkeletons() {
  return (
    <div className="space-y-0">
      {Array.from({ length: 5 }, (_, i) => `skeleton-${i}`).map((key) => (
        <div
          key={key}
          className="flex items-start gap-3 py-2.5 border-b border-border last:border-0"
        >
          <Skeleton className="mt-0.5 h-4 w-4 shrink-0 rounded" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-3/4" />
          </div>
          <Skeleton className="mt-0.5 h-3 w-12 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export default function ActivityLog() {
  const selectedOrgId = useAppStore((s) => s.selectedOrgId);

  const entries = useQuery(
    api.activityLog.list,
    selectedOrgId ? { orgId: selectedOrgId } : 'skip',
  ) as ActivityEntry[] | undefined;

  return (
    <ScrollArea className="h-full">
      <div className="px-4 py-2">
        {entries === undefined ? (
          <ActivityLogSkeletons />
        ) : entries.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No activity yet
          </p>
        ) : (
          <div>
            {entries.map((entry) => (
              <ActivityItem key={entry._id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
