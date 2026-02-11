import type React from 'react';
import { cn } from '../../lib/utils';

export interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

function PageHeader({ className, ...props }: PageHeaderProps) {
  return (
    <div
      className={cn('h-14 shrink-0 flex items-center border-b px-4', className)}
      {...props}
    />
  );
}

export default PageHeader;
