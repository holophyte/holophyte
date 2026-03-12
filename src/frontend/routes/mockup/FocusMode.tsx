import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  FileCode,
  GitCommit,
  Pause,
  Play,
  Send,
  Settings,
  TestTube,
} from 'lucide-react';
import { useState } from 'react';
import Button from '@/frontend/components/ui/Button';
import { cn } from '@/frontend/lib/utils';

interface FocusModeProps {
  onBack: () => void;
}

type ReviewTab = 'summary' | 'diff' | 'tests';

const CHANGED_FILES = [
  {
    path: 'src/models/user.ts',
    additions: 48,
    deletions: 12,
    confidence: 'High' as const,
  },
  {
    path: 'src/models/profile.ts',
    additions: 95,
    deletions: 0,
    confidence: 'High' as const,
  },
  {
    path: 'src/auth/session.ts',
    additions: 8,
    deletions: 3,
    confidence: 'Medium' as const,
  },
  {
    path: 'convex/schema.ts',
    additions: 14,
    deletions: 6,
    confidence: 'High' as const,
  },
];

const confidenceColor: Record<'High' | 'Medium' | 'Low', string> = {
  High: 'text-emerald-500',
  Medium: 'text-amber-500',
  Low: 'text-red-400',
};

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 py-1" aria-busy="true">
      <div className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 motion-safe:animate-bounce"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground italic">Thinking…</span>
    </div>
  );
}

function ToolUseBlock({
  tool,
  path,
  action,
}: {
  tool: string;
  path: string;
  action?: string;
}) {
  return (
    <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2 flex items-center gap-2 text-xs">
      <FileCode className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="font-mono text-muted-foreground">{tool}</span>
      <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
      <span className="font-mono text-foreground truncate">{path}</span>
      {action && (
        <span className="ml-auto text-muted-foreground/70 shrink-0">
          {action}
        </span>
      )}
    </div>
  );
}

export default function FocusMode({ onBack }: FocusModeProps) {
  const [activeTab, setActiveTab] = useState<ReviewTab>('summary');
  const [composerValue, setComposerValue] = useState('');
  const [elapsed] = useState('8 min focused');

  const tabs: { id: ReviewTab; label: string }[] = [
    { id: 'summary', label: 'Summary' },
    { id: 'diff', label: 'Diff' },
    { id: 'tests', label: 'Tests' },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-background">
      {/* Top bar */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-border/50 bg-card/50">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors duration-150 cursor-pointer shrink-0"
          aria-label="Back to Decision Queue"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Queue</span>
        </button>

        <div className="h-4 w-px bg-border/50 shrink-0" />

        <div className="flex-1 min-w-0 flex items-center gap-2">
          <h1 className="text-sm font-semibold truncate">
            Refactor user model (#45)
          </h1>
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className="h-2 w-2 rounded-full bg-emerald-500 motion-safe:animate-pulse"
              aria-hidden="true"
            />
            <span className="text-xs text-emerald-500 font-medium">
              Running
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
          <span>{elapsed}</span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            aria-label="Pause session"
          >
            <Pause className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Split view */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left panel — session thread */}
        <div className="flex flex-col flex-1 min-h-0 min-w-0 border-r border-border/50">
          {/* Thread */}
          <div
            role="log"
            aria-label="Session output"
            aria-live="polite"
            className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0"
          >
            {/* User message */}
            <article className="flex justify-end" aria-label="Your message">
              <div className="max-w-[80%] rounded-xl rounded-br-sm bg-primary px-4 py-2.5">
                <p className="text-sm text-primary-foreground leading-relaxed">
                  Refactor the user model to separate profile data from auth
                  credentials. Profile should include displayName, avatarUrl,
                  bio. Auth should keep email, passwordHash, lastLogin.
                </p>
              </div>
            </article>

            {/* Agent message 1 */}
            <article aria-label="Agent message" className="space-y-2">
              <div className="flex items-start gap-2.5">
                <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold text-primary">A</span>
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="rounded-xl rounded-tl-sm bg-card border border-border/50 px-4 py-3">
                    <p className="text-sm text-foreground leading-relaxed">
                      I'll refactor the user model to cleanly separate profile
                      data from auth credentials. Let me first read the current
                      structure.
                    </p>
                  </div>
                  <ToolUseBlock tool="Read" path="src/models/user.ts" />
                  <div className="rounded-xl rounded-tl-sm bg-card border border-border/50 px-4 py-3">
                    <p className="text-sm text-foreground leading-relaxed">
                      The current{' '}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                        User
                      </code>{' '}
                      model mixes auth and profile fields. I'll create a
                      separate{' '}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                        Profile
                      </code>{' '}
                      model and update all references.
                    </p>
                  </div>
                  <ToolUseBlock
                    tool="Edit"
                    path="src/models/user.ts"
                    action="splitting auth fields"
                  />
                  <ToolUseBlock
                    tool="Write"
                    path="src/models/profile.ts"
                    action="new file"
                  />
                </div>
              </div>
            </article>

            {/* Thinking indicator */}
            <div className="flex items-start gap-2.5">
              <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[10px] font-bold text-primary">A</span>
              </div>
              <ThinkingIndicator />
            </div>
          </div>

          {/* Composer */}
          <div className="shrink-0 border-t border-border/50 px-4 py-3">
            <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-2 focus-within:ring-1 focus-within:ring-ring transition-shadow">
              <input
                type="text"
                value={composerValue}
                onChange={(e) => setComposerValue(e.target.value)}
                placeholder="Send a follow-up message..."
                aria-label="Follow-up message"
                className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground/60 focus:outline-none"
              />
              <button
                type="button"
                aria-label="Send message"
                className="text-muted-foreground hover:text-foreground transition-colors duration-150 disabled:opacity-40 cursor-pointer"
                disabled={!composerValue.trim()}
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Right panel — review */}
        <div className="w-[420px] shrink-0 flex flex-col min-h-0 overflow-hidden">
          {/* Tabs */}
          <div
            className="shrink-0 flex border-b border-border/50"
            role="tablist"
            aria-label="Review panels"
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex-1 px-3 py-2.5 text-xs font-medium transition-colors duration-150 border-b-2 cursor-pointer',
                  activeTab === tab.id
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div
            role="tabpanel"
            aria-label={`${activeTab} panel`}
            className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0"
          >
            {activeTab === 'summary' && (
              <>
                {/* Summary card */}
                <div className="rounded-lg border border-border/50 bg-card/50 px-4 py-3 space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Session Summary
                  </h3>
                  <ul className="space-y-1.5 text-sm text-foreground">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      Separated auth credentials from user profile data
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      Created new Profile model with social fields
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      Updated session auth to reference Auth model
                    </li>
                  </ul>
                </div>

                {/* Files changed */}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Files Changed
                  </h3>
                  <div className="space-y-1.5">
                    {CHANGED_FILES.map((file) => (
                      <div
                        key={file.path}
                        className="flex items-center gap-2 rounded-md px-3 py-2 bg-card/50 border border-border/30"
                      >
                        <FileCode className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="flex-1 font-mono text-xs text-foreground truncate">
                          {file.path}
                        </span>
                        <span className="text-xs font-mono text-emerald-500">
                          +{file.additions}
                        </span>
                        <span className="text-xs font-mono text-red-400">
                          -{file.deletions}
                        </span>
                        <span
                          className={cn(
                            'text-[10px] font-semibold shrink-0',
                            confidenceColor[file.confidence],
                          )}
                        >
                          {file.confidence}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Test results */}
                <div className="rounded-lg border border-border/50 bg-card/50 px-3 py-2.5 flex items-center gap-2">
                  <TestTube className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Tests{' '}
                    <span className="font-medium text-amber-500">pending</span>
                  </span>
                </div>
              </>
            )}

            {activeTab === 'diff' && (
              <div className="rounded-lg border border-border/50 bg-card/50 px-4 py-6 text-center">
                <p className="text-sm text-muted-foreground">
                  Diff view available after agent completes changes
                </p>
              </div>
            )}

            {activeTab === 'tests' && (
              <div className="rounded-lg border border-border/50 bg-card/50 px-4 py-6 text-center">
                <p className="text-sm text-muted-foreground">
                  Run tests to see results
                </p>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="shrink-0 border-t border-border/50 px-4 py-3 flex flex-col gap-2">
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 gap-1.5 text-xs"
              >
                <Play className="h-3.5 w-3.5" />
                Run Tests
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 gap-1.5 text-xs"
              >
                <GitCommit className="h-3.5 w-3.5" />
                View Diff
              </Button>
            </div>
            <Button size="sm" className="w-full gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Approve &amp; Commit
            </Button>
          </div>
        </div>
      </div>

      {/* Presence bar */}
      <section
        className="shrink-0 border-t border-border/50 bg-card/30 px-4 py-2 flex items-center gap-4 overflow-x-auto"
        aria-label="Active collaborators"
      >
        <span className="text-xs text-muted-foreground shrink-0">
          Working together
        </span>
        <div className="h-3 w-px bg-border/50 shrink-0" />
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-xs text-foreground shrink-0">
            <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center">
              <span className="text-[9px] font-bold text-primary">Y</span>
            </div>
            <span>You</span>
            <span className="text-muted-foreground">
              reviewing user model · 8m
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs shrink-0">
            <div className="h-5 w-5 rounded-full bg-blue-500/20 flex items-center justify-center">
              <span className="text-[9px] font-bold text-blue-400">1</span>
            </div>
            <span className="text-foreground">Agent 1</span>
            <span className="text-muted-foreground">writing payment tests</span>
            <span className="text-muted-foreground">47% · 12m</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs shrink-0">
            <div className="h-5 w-5 rounded-full bg-purple-500/20 flex items-center justify-center">
              <span className="text-[9px] font-bold text-purple-400">4</span>
            </div>
            <span className="text-foreground">Agent 4</span>
            <span className="text-muted-foreground">schema migration</span>
            <span className="text-muted-foreground">18% · 1m</span>
          </div>
        </div>
      </section>
    </div>
  );
}
