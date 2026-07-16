import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type StatusTone = 'online' | 'degraded' | 'maintenance' | 'offline';

const toneClasses: Record<StatusTone, string> = {
  online: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  maintenance: 'bg-blue-500',
  offline: 'bg-destructive',
};

export function Status({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('inline-flex items-center gap-2 text-xs text-muted-foreground', className)} {...props} />;
}

export function StatusIndicator({ tone = 'online', className }: { tone?: StatusTone; className?: string }) {
  return (
    <span className="relative flex h-2 w-2">
      <span className={cn('absolute inset-0 animate-status-ping rounded-full', toneClasses[tone])} />
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', toneClasses[tone], className)} />
    </span>
  );
}

export function StatusLabel({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('font-medium text-foreground', className)} {...props} />;
}
