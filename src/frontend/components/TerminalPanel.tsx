import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useTerminal } from "@/frontend/hooks/useTerminal";
import { cn } from "@/frontend/lib/utils";
import { useAppStore } from "@/frontend/stores/app";
import { Button } from "./ui/button";

export function TerminalPanel() {
  const terminalSessionId = useAppStore((s) => s.terminalSessionId);
  const terminalMinimized = useAppStore((s) => s.terminalMinimized);
  const closeTerminal = useAppStore((s) => s.closeTerminal);
  const toggleTerminalMinimized = useAppStore((s) => s.toggleTerminalMinimized);

  const terminalRef = useTerminal(terminalSessionId);

  return (
    <div
      className={cn(
        "border-t bg-background flex flex-col transition-all",
        terminalMinimized ? "h-10" : "h-80",
      )}
    >
      <div className="flex items-center justify-between px-3 py-1 border-b bg-muted/50">
        <span className="text-xs font-medium text-muted-foreground">
          Terminal — {terminalSessionId?.slice(0, 8)}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={toggleTerminalMinimized}
          >
            {terminalMinimized ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={closeTerminal}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {!terminalMinimized && (
        <div ref={terminalRef} className="flex-1 bg-black" />
      )}
    </div>
  );
}
