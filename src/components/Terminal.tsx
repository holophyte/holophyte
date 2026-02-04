import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  onData?: (data: string) => void;
  className?: string;
}

export function Terminal({ onData, className }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);

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
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
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

    if (onData) {
      xterm.onData(onData);
    }

    xtermRef.current = xterm;

    const handleResize = () => fitAddon.fit();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      xterm.dispose();
      xtermRef.current = null;
    };
  }, [onData]);

  return <div ref={terminalRef} className={className} />;
}

export function useTerminal() {
  const terminalRef = useRef<XTerm | null>(null);

  const write = (data: string) => {
    terminalRef.current?.write(data);
  };

  const writeln = (data: string) => {
    terminalRef.current?.writeln(data);
  };

  const clear = () => {
    terminalRef.current?.clear();
  };

  return { terminalRef, write, writeln, clear };
}
