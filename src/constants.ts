export const TERMINAL_DEFAULTS = {
  cols: 120,
  rows: 30,
} as const;

export const ansi = {
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
};
