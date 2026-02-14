import { ChevronDown, Pause, Play, RotateCcw, Settings } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/frontend/lib/utils';
import { useAppStore } from '@/frontend/stores/app';
import Button from './ui/Button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/Popover';

const BREAK_SUGGESTIONS = [
  'Stand up and stretch',
  'Look away from the screen for 20 seconds',
  'Roll your shoulders and neck',
  'Drink some water',
  'Shake out your hands and wrists',
  'Take 3 slow, deep breaths',
  'Walk to another room and back',
  'Close your eyes for 30 seconds',
];

const INTERVAL_OPTIONS = [0, 15, 20, 25, 30, 45, 60];

function pickSuggestion(): string {
  const idx = Math.floor(Math.random() * BREAK_SUGGESTIONS.length);
  return BREAK_SUGGESTIONS[idx] ?? BREAK_SUGGESTIONS[0]!;
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function BreakTimer() {
  const breakInterval = useAppStore((s) => s.breakInterval);
  const setBreakInterval = useAppStore((s) => s.setBreakInterval);

  const [secondsLeft, setSecondsLeft] = useState(breakInterval * 60);
  const [running, setRunning] = useState(breakInterval > 0);
  const [breakAlert, setBreakAlert] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset timer when interval changes
  useEffect(() => {
    setSecondsLeft(breakInterval * 60);
    setRunning(breakInterval > 0);
    setBreakAlert(null);
  }, [breakInterval]);

  // Tick
  useEffect(() => {
    if (!running || breakInterval === 0) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    intervalRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setRunning(false);
          setBreakAlert(pickSuggestion());
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running, breakInterval]);

  const handleReset = useCallback(() => {
    setSecondsLeft(breakInterval * 60);
    setRunning(true);
    setBreakAlert(null);
  }, [breakInterval]);

  const togglePause = useCallback(() => {
    if (breakAlert) {
      handleReset();
      return;
    }
    setRunning((prev) => !prev);
  }, [breakAlert, handleReset]);

  if (breakInterval === 0 && !breakAlert) {
    return (
      <div className="flex items-center gap-2">
        <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-muted/50"
              aria-label="Break timer settings"
            >
              <Settings className="h-3.5 w-3.5" />
              Break timer off
            </button>
          </PopoverTrigger>
          <IntervalPopover
            current={breakInterval}
            onChange={(v) => {
              setBreakInterval(v);
              setSettingsOpen(false);
            }}
          />
        </Popover>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {breakAlert ? (
        <div className="flex items-center gap-2 animate-pulse">
          <span className="text-xs font-medium text-amber-500">
            Break time!
          </span>
          <span className="text-xs text-muted-foreground">{breakAlert}</span>
        </div>
      ) : (
        <span
          className={cn(
            'text-xs font-mono tabular-nums',
            !running && 'text-muted-foreground',
          )}
        >
          {formatTime(secondsLeft)}
        </span>
      )}

      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={togglePause}
        aria-label={breakAlert ? 'Restart timer' : running ? 'Pause' : 'Resume'}
      >
        {breakAlert ? (
          <RotateCcw className="h-3 w-3" />
        ) : running ? (
          <Pause className="h-3 w-3" />
        ) : (
          <Play className="h-3 w-3" />
        )}
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={handleReset}
        aria-label="Reset timer"
      >
        <RotateCcw className="h-3 w-3" />
      </Button>

      <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-1 py-0.5 rounded hover:bg-muted/50"
            aria-label="Change break interval"
          >
            <span>{breakInterval}m</span>
            <ChevronDown className="h-3 w-3" />
          </button>
        </PopoverTrigger>
        <IntervalPopover
          current={breakInterval}
          onChange={(v) => {
            setBreakInterval(v);
            setSettingsOpen(false);
          }}
        />
      </Popover>
    </div>
  );
}

interface IntervalPopoverProps {
  current: number;
  onChange: (minutes: number) => void;
}

function IntervalPopover({ current, onChange }: IntervalPopoverProps) {
  return (
    <PopoverContent className="w-36 p-1" align="end">
      {INTERVAL_OPTIONS.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={cn(
            'w-full text-left px-2.5 py-1.5 rounded text-sm hover:bg-muted/50 transition-colors',
            current === m && 'bg-muted font-medium',
          )}
        >
          {m === 0 ? 'Off' : `${m} min`}
        </button>
      ))}
    </PopoverContent>
  );
}
