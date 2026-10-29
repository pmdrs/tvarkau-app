import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// Native lazy loading; a skeleton stays until the image has decoded.
export function LazyImage({ src, alt = '', className }) {
  const [state, setState] = useState('loading');
  return (
    <div className={cn('relative overflow-hidden rounded-md bg-muted', className)}>
      {state === 'loading' && <Skeleton className="absolute inset-0 rounded-none" />}
      {state === 'error' ? (
        <div className="absolute inset-0 grid place-items-center text-muted-foreground"><ImageOff className="size-5" /></div>
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
          className={cn('size-full object-cover transition-opacity duration-300', state === 'ok' ? 'opacity-100' : 'opacity-0')}
        />
      )}
    </div>
  );
}
