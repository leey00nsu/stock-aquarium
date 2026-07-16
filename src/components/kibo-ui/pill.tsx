import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Pill({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border bg-background/70 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm backdrop-blur-xl',
        className,
      )}
      {...props}
    />
  );
}
