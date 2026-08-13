/**
 * lib/format/date.ts
 * Formatação de datas — extraído de app/dashboard/page.tsx (Etapa 8.1)
 * para ser reutilizado por app/dashboard/profile/page.tsx sem duplicar a
 * lógica. Comportamento idêntico ao original, só movido de lugar.
 */

/**
 * Para colunas `date` (sem horário, ex.: `collector_since`,
 * `purchase_date`) — formatar via `Date` + `toLocaleDateString` local
 * sofreria deslocamento de fuso (meia-noite UTC vira o dia anterior em
 * fusos negativos, ex.: Brasil). Extraímos os componentes literais da
 * string "AAAA-MM-DD" em vez de deixar o `Date` reinterpretar o fuso.
 */
export function formatDateOnly(isoDate: string): string {
  const [year, month, day] = isoDate.split('-')
  return `${day}/${month}/${year}`
}

/**
 * Para colunas `timestamptz` (ex.: `created_at`) — aqui a conversão de
 * fuso horário é correta (o timestamp representa um instante real), ao
 * contrário de `formatDateOnly`.
 */
export function formatTimestampDate(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleDateString('pt-BR')
}
