import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import "@xterm/xterm/css/xterm.css";

export interface TerminalHandle {
  write: (data: string) => void;
  writeln: (data: string) => void;
  clear: () => void;
}

interface TerminalProps {
  onData?: (data: string) => void;
  className?: string;
}

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(
  function Terminal({ onData, className }, ref) {
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<XTerm | null>(null);
    const onDataRef = useRef(onData);
    onDataRef.current = onData;

    useImperativeHandle(ref, () => ({
      write: (data: string) => xtermRef.current?.write(data),
      writeln: (data: string) => xtermRef.current?.writeln(data),
      clear: () => xtermRef.current?.clear(),
    }));

    useEffect(() => {
      if (!terminalRef.current || xtermRef.current) return;

      const xterm = new XTerm({
        theme: {
          background: "#0a0a0f",
          foreground: "#e4e4e7",
          cursor: "#e4e4e7",
          cursorAccent: "#0a0a0f",
          selectionBackground: "#3f3f46",
        },
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 14,
        cursorBlink: true,
      });

      const fitAddon = new FitAddon();
      xterm.loadAddon(fitAddon);

      xterm.open(terminalRef.current);
      fitAddon.fit();

      xterm.writeln("Welcome to Holophyte Terminal");
      xterm.writeln("");
      xterm.write("$ ");

      xterm.onData((data) => onDataRef.current?.(data));

      xtermRef.current = xterm;

      const handleResize = () => fitAddon.fit();
      window.addEventListener("resize", handleResize);

      return () => {
        window.removeEventListener("resize", handleResize);
        xterm.dispose();
        xtermRef.current = null;
      };
    }, []);

    return <div ref={terminalRef} className={className} />;
  },
);

export function useTerminal() {
  const ref = useRef<TerminalHandle>(null);

  return {
    ref,
    write: (data: string) => ref.current?.write(data),
    writeln: (data: string) => ref.current?.writeln(data),
    clear: () => ref.current?.clear(),
  };
}
