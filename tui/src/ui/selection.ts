/** Shared list-selection helper for the TUI and the sidebar pane. */

/** Selected id if still present in the list, else the first item (clamp). */
export function effectiveId(
  ids: string[],
  selectedId: string | null,
): string | null {
  if (selectedId !== null && ids.includes(selectedId)) return selectedId;
  return ids[0] ?? null;
}
