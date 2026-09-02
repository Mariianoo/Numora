/**
 * components/ui/Avatar.tsx
 * Círculo com iniciais — sem foto real nesta etapa (sem upload de imagem).
 */
import { cn } from './utils'

export interface AvatarProps {
  name: string
  /** 'lg' (Passport V1) — hero do cabeçalho público, único caller até agora é app/passport/[username]/page.tsx. */
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const SIZE_CLASSES = {
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-20 text-2xl',
}

export function Avatar({ name, size = 'md', className }: AvatarProps) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-accent/15 font-semibold text-accent',
        SIZE_CLASSES[size],
        className,
      )}
      aria-hidden
    >
      {getInitials(name)}
    </div>
  )
}
