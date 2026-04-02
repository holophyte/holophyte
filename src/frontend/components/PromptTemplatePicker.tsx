import { api } from '@convex/_generated/api';
import type { Doc, Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { FileText, Globe, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import Button from './ui/Button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/Dialog';
import Input from './ui/Input';
import Label from './ui/Label';
import { Popover, PopoverContent, PopoverTrigger } from './ui/Popover';
import Textarea from './ui/Textarea';

/** Extract {{placeholder}} names from template content */
function extractPlaceholders(content: string): string[] {
  const matches = content.match(/\{\{([^{}]+)\}\}/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.slice(2, -2).trim()))];
}

/** Replace {{placeholder}} tokens with values */
function fillPlaceholders(
  content: string,
  values: Record<string, string>,
): string {
  return content.replace(/\{\{([^{}]+)\}\}/g, (_, name: string) => {
    return values[name.trim()] ?? `{{${name.trim()}}}`;
  });
}

interface PromptTemplatePickerProps {
  repoId?: Id<'repos'>;
  onApply: (content: string) => void;
}

export function PromptTemplatePicker({
  repoId,
  onApply,
}: PromptTemplatePickerProps) {
  const templates = useQuery(
    api.promptTemplates.list,
    repoId ? { repoId } : {},
  );
  const createTemplate = useMutation(api.promptTemplates.create);
  const updateTemplate = useMutation(api.promptTemplates.update);
  const removeTemplate = useMutation(api.promptTemplates.remove);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] =
    useState<Doc<'promptTemplates'> | null>(null);
  const [creating, setCreating] = useState(false);
  const [fillTemplate, setFillTemplate] =
    useState<Doc<'promptTemplates'> | null>(null);
  const [placeholderValues, setPlaceholderValues] = useState<
    Record<string, string>
  >({});

  // Create/edit form state
  const [formName, setFormName] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formIsGlobal, setFormIsGlobal] = useState(false);

  const openCreateForm = () => {
    setFormName('');
    setFormContent('');
    setFormIsGlobal(false);
    setEditingTemplate(null);
    setCreating(true);
  };

  const openEditForm = (template: Doc<'promptTemplates'>) => {
    setFormName(template.name);
    setFormContent(template.content);
    setFormIsGlobal(!template.repoId);
    setEditingTemplate(template);
    setCreating(true);
  };

  const handleSaveTemplate = async () => {
    const name = formName.trim();
    const content = formContent.trim();
    if (!name || !content) return;

    if (editingTemplate) {
      await updateTemplate({ id: editingTemplate._id, name, content });
    } else {
      await createTemplate({
        name,
        content,
        repoId: formIsGlobal ? undefined : repoId,
      });
    }
    setCreating(false);
    setEditingTemplate(null);
  };

  const handleDeleteTemplate = async (id: Id<'promptTemplates'>) => {
    await removeTemplate({ id });
  };

  const handleSelectTemplate = (template: Doc<'promptTemplates'>) => {
    const placeholders = extractPlaceholders(template.content);
    if (placeholders.length > 0) {
      setFillTemplate(template);
      setPlaceholderValues({});
    } else {
      onApply(template.content);
      setPickerOpen(false);
    }
  };

  const handleApplyFilled = () => {
    if (!fillTemplate) return;
    const filled = fillPlaceholders(fillTemplate.content, placeholderValues);
    onApply(filled);
    setFillTemplate(null);
    setPickerOpen(false);
  };

  const placeholders = fillTemplate
    ? extractPlaceholders(fillTemplate.content)
    : [];

  return (
    <>
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
            <FileText className="h-3 w-3" />
            Templates
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-72 p-2"
          align="start"
          data-task-detail-portal=""
        >
          {templates && templates.length > 0 ? (
            <div className="space-y-0.5 max-h-60 overflow-y-auto">
              {templates.map((t) => (
                <div
                  key={t._id}
                  className="group flex items-center gap-1 rounded hover:bg-muted transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => handleSelectTemplate(t)}
                    className="flex-1 text-left px-2 py-1.5 min-w-0"
                  >
                    <div className="flex items-center gap-1.5">
                      {!t.repoId && (
                        <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
                      )}
                      <span className="text-sm truncate">{t.name}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                      {t.content.slice(0, 60)}
                      {t.content.length > 60 ? '...' : ''}
                    </p>
                  </button>
                  <div className="flex shrink-0 opacity-0 group-hover:opacity-100 transition-opacity pr-1">
                    <button
                      type="button"
                      onClick={() => openEditForm(t)}
                      className="p-1 text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteTemplate(t._id)}
                      className="p-1 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-3">
              No templates yet.
            </p>
          )}
          <button
            type="button"
            onClick={openCreateForm}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-muted-foreground hover:bg-muted transition-colors mt-1 border-t pt-2"
          >
            <Plus className="h-3.5 w-3.5" />
            Create template
          </button>
        </PopoverContent>
      </Popover>

      {/* Create/Edit template dialog */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSaveTemplate();
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {editingTemplate ? 'Edit Template' : 'Create Template'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="template-name">Name</Label>
                <Input
                  id="template-name"
                  placeholder="e.g. Write tests for X"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-content">
                  Content
                  <span className="text-muted-foreground font-normal ml-1">
                    {'(use {{placeholder}} for fill-in fields)'}
                  </span>
                </Label>
                <Textarea
                  id="template-content"
                  placeholder={
                    'Write comprehensive tests for {{module}}.\nInclude edge cases for {{scenario}}.'
                  }
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                  rows={6}
                  className="font-mono text-xs"
                />
                {extractPlaceholders(formContent).length > 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    Placeholders:{' '}
                    {extractPlaceholders(formContent).map((p, i) => (
                      <span key={p}>
                        {i > 0 && ', '}
                        <code className="bg-muted px-1 rounded">{`{{${p}}}`}</code>
                      </span>
                    ))}
                  </p>
                )}
              </div>
              {!editingTemplate && repoId && (
                <div className="flex items-center gap-2">
                  <input
                    id="template-global"
                    type="checkbox"
                    checked={formIsGlobal}
                    onChange={(e) => setFormIsGlobal(e.target.checked)}
                    className="rounded"
                  />
                  <Label
                    htmlFor="template-global"
                    className="text-sm font-normal"
                  >
                    Global template (available in all repos)
                  </Label>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreating(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!formName.trim() || !formContent.trim()}
              >
                {editingTemplate ? 'Save' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Placeholder fill-in dialog */}
      <Dialog
        open={fillTemplate !== null}
        onOpenChange={(open) => {
          if (!open) setFillTemplate(null);
        }}
      >
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleApplyFilled();
            }}
          >
            <DialogHeader>
              <DialogTitle>Fill in placeholders</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <p className="text-sm text-muted-foreground">
                {fillTemplate?.name}
              </p>
              {placeholders.map((name) => (
                <div key={name} className="space-y-1">
                  <Label htmlFor={`ph-${name}`} className="font-mono text-xs">
                    {`{{${name}}}`}
                  </Label>
                  <Input
                    id={`ph-${name}`}
                    placeholder={name}
                    value={placeholderValues[name] ?? ''}
                    onChange={(e) =>
                      setPlaceholderValues((prev) => ({
                        ...prev,
                        [name]: e.target.value,
                      }))
                    }
                    autoFocus={placeholders.indexOf(name) === 0}
                  />
                </div>
              ))}
              {fillTemplate && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Preview
                  </Label>
                  <pre className="text-xs font-mono bg-muted p-2 rounded whitespace-pre-wrap max-h-32 overflow-y-auto">
                    {fillPlaceholders(fillTemplate.content, placeholderValues)}
                  </pre>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setFillTemplate(null)}
              >
                Cancel
              </Button>
              <Button type="submit">Apply</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
