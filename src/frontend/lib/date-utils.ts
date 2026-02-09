export function formatRelativeDate(timestamp: number): string {
  const now = Date.now();
  const diff = timestamp - now;
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  if (days < -1) return `${Math.abs(days)}d overdue`;
  if (days === -1) return "1d overdue";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `${days}d`;
}

export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return "<1m";
}

export function timestampToDateInput(timestamp: number): string {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateInputToTimestamp(value: string): number {
  // Parse as local date at start of day
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year!, month! - 1, day!).getTime();
}
