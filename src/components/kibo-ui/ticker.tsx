import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Ticker({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-3 rounded-xl border bg-card/70 px-4 py-3 text-card-foreground shadow-sm backdrop-blur-xl',
        className,
      )}
      {...props}
    />
  );
}

export function TickerSymbol({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-w-0', className)} {...props} />;
}

export function TickerPrice({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('ml-auto text-right tabular-nums', className)} {...props} />;
}

export function TickerChange({ trend, className, ...props }: HTMLAttributes<HTMLSpanElement> & { trend: 'up' | 'down' | 'flat' }) {
  return (
    <span
      className={cn(
        'text-xs font-medium tabular-nums',
        trend === 'up' && 'text-emerald-600 dark:text-emerald-400',
        trend === 'down' && 'text-destructive',
        trend === 'flat' && 'text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
