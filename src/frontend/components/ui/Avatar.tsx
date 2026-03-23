import { Flower } from 'lucide-react';
import { cn } from '../../lib/utils';

interface AvatarProps {
  src?: string | null;
  name?: string | null;
  className?: string;
}

export default function Avatar({ src, name, className }: AvatarProps) {
  const initials = name
    ? name
        .split(' ')
        .filter(Boolean)
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : null;

  if (src) {
    return (
      <img
        src={src}
        alt={name ?? 'Avatar'}
        className={cn('h-8 w-8 rounded-full object-cover', className)}
      />
    );
  }

  return (
    <div
      className={cn(
        'h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground',
        className,
      )}
    >
      {initials ?? <Flower className="h-3/5 w-3/5" />}
    </div>
  );
}
