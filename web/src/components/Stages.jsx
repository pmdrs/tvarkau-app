import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

// One pipeline step: pending → active (spinner, optional progress bar) → done | error.
export function Stage({ state = 'pending', label, detail, progress }) {
  const Icon = { pending: Circle, active: Loader2, done: CheckCircle2, error: XCircle }[state];
  return (
    <li className="flex items-start gap-3 py-1.5">
      <Icon
        className={cn('mt-0.5 size-4 shrink-0', {
          'text-muted-foreground/50': state === 'pending',
          'animate-spin text-primary': state === 'active',
          'text-success': state === 'done',
          'text-destructive': state === 'error',
        })}
      />
      <div className="min-w-0 flex-1">
        <div className={cn('text-sm', state === 'pending' && 'text-muted-foreground')}>
          {label}
          {detail && <span className="ml-2 text-xs text-muted-foreground">{detail}</span>}
        </div>
        {progress != null && state === 'active' && <Progress value={Math.round(progress * 100)} className="mt-1.5 h-1.5" />}
      </div>
    </li>
  );
}

export function StageList({ children, className }) {
  return <ol className={cn('divide-y divide-border/50', className)}>{children}</ol>;
}

// State of step `i` given the index of the step in progress (`at`) and an optional failure.
export const stepState = (i, at, failed) => (i < at ? 'done' : i === at ? (failed ? 'error' : 'active') : 'pending');
