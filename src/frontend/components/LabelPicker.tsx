import { api } from '@convex/_generated/api';
import type { Doc, Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/frontend/lib/utils';
import Button from './ui/Button';
import Input from './ui/Input';
import { Popover, PopoverContent, PopoverTrigger } from './ui/Popover';

const LABEL_COLORS = [
  { name: 'Red', hex: '#ef4444' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Yellow', hex: '#eab308' },
  { name: 'Green', hex: '#22c55e' },
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Purple', hex: '#8b5cf6' },
  { name: 'Pink', hex: '#ec4899' },
  { name: 'Gray', hex: '#6b7280' },
];

interface LabelPickerProps {
  currentLabelIds: Id<'labels'>[];
  onChangeLabelIds: (labelIds: Id<'labels'>[]) => void;
}

export function LabelPicker({
  currentLabelIds,
  onChangeLabelIds,
}: LabelPickerProps) {
  const labels = useQuery(api.labels.list);
  const createLabel = useMutation(api.labels.create);
  const updateLabel = useMutation(api.labels.update);
  const removeLabel = useMutation(api.labels.remove);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(LABEL_COLORS[0]?.hex ?? '#ef4444');
  const [editingId, setEditingId] = useState<Id<'labels'> | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  const toggleLabel = (labelId: Id<'labels'>) => {
    if (currentLabelIds.includes(labelId)) {
      onChangeLabelIds(currentLabelIds.filter((id) => id !== labelId));
    } else {
      onChangeLabelIds([...currentLabelIds, labelId]);
    }
  };

  const handleCreateLabel = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const id = await createLabel({ name: trimmed, color: newColor });
    onChangeLabelIds([...currentLabelIds, id]);
    setNewName('');
    setCreating(false);
  };

  const startEditing = (label: Doc<'labels'>, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(label._id);
    setEditName(label.name);
    setEditColor(label.color);
    setCreating(false);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    const trimmed = editName.trim();
    if (!trimmed) return;
    await updateLabel({ id: editingId, name: trimmed, color: editColor });
    setEditingId(null);
  };

  const handleDelete = async (labelId: Id<'labels'>, e: React.MouseEvent) => {
    e.stopPropagation();
    onChangeLabelIds(currentLabelIds.filter((id) => id !== labelId));
    await removeLabel({ id: labelId });
    if (editingId === labelId) setEditingId(null);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          <Tag className="h-3.5 w-3.5" />
          Tags
          {currentLabelIds.length > 0 && (
            <span className="ml-1 bg-muted rounded-full px-1.5 text-[10px]">
              {currentLabelIds.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-2" align="start">
        <div className="space-y-1">
          {labels?.map((label) =>
            editingId === label._id ? (
              <div key={label._id} className="space-y-2 p-2 rounded bg-muted">
                <Input
                  placeholder="Tag name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveEdit();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="h-7 text-xs"
                  autoFocus
                />
                <div className="flex gap-1 flex-wrap">
                  {LABEL_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setEditColor(c.hex)}
                      className={cn(
                        'h-5 w-5 rounded-sm border-2 transition-colors',
                        editColor === c.hex
                          ? 'border-foreground'
                          : 'border-transparent',
                      )}
                      style={{ backgroundColor: c.hex }}
                      title={c.name}
                    />
                  ))}
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    className="h-6 text-xs flex-1"
                    onClick={handleSaveEdit}
                    disabled={!editName.trim()}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs"
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div
                key={label._id}
                className={cn(
                  'group flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-muted transition-colors',
                  currentLabelIds.includes(label._id) && 'bg-muted',
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleLabel(label._id)}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left"
                >
                  <span
                    className="h-3 w-3 rounded-sm shrink-0"
                    style={{ backgroundColor: label.color }}
                  />
                  <span className="truncate flex-1">{label.name}</span>
                  {currentLabelIds.includes(label._id) && (
                    <span className="text-xs text-primary">&#10003;</span>
                  )}
                </button>
                <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => startEditing(label, e)}
                    className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                    title="Edit tag"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleDelete(label._id, e)}
                    className="p-0.5 rounded text-muted-foreground hover:text-red-500 transition-colors"
                    title="Delete tag"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
        {creating ? (
          <div className="mt-2 space-y-2 border-t pt-2">
            <Input
              placeholder="Tag name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateLabel();
                if (e.key === 'Escape') setCreating(false);
              }}
              className="h-7 text-xs"
              autoFocus
            />
            <div className="flex gap-1 flex-wrap">
              {LABEL_COLORS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => setNewColor(c.hex)}
                  className={cn(
                    'h-5 w-5 rounded-sm border-2 transition-colors',
                    newColor === c.hex
                      ? 'border-foreground'
                      : 'border-transparent',
                  )}
                  style={{ backgroundColor: c.hex }}
                  title={c.name}
                />
              ))}
            </div>
            <div className="flex gap-1">
              <Button
                size="sm"
                className="h-6 text-xs flex-1"
                onClick={handleCreateLabel}
                disabled={!newName.trim()}
              >
                Add
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-xs"
                onClick={() => setCreating(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setEditingId(null);
            }}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-muted-foreground hover:bg-muted transition-colors mt-1 border-t pt-2"
          >
            <Plus className="h-3.5 w-3.5" />
            Create new tag
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function LabelDots({ labels }: { labels: Doc<'labels'>[] }) {
  if (labels.length === 0) return null;
  return (
    <div className="flex gap-1 flex-wrap">
      {labels.map((label) => (
        <span
          key={label._id}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
          style={{ backgroundColor: label.color }}
        >
          {label.name}
        </span>
      ))}
    </div>
  );
}
