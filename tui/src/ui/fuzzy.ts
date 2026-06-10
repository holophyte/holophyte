/** Case-insensitive subsequence match. Empty needle matches everything. */
export function fuzzyMatch(needle: string, haystack: string): boolean {
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  let i = 0;
  for (const ch of h) {
    if (i < n.length && ch === n[i]) i++;
  }
  return i === n.length;
}
