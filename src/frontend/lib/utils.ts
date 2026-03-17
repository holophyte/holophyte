import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge class names with Tailwind conflict resolution. Combines `clsx` (conditional classes) with `tailwind-merge` (deduplication). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
