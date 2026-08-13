/**
 * components/ui/utils.ts
 * Helper mínimo de composição de classNames — evita depender de clsx/cva
 * para um conjunto pequeno de componentes.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}
