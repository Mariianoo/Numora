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

/**
 * Converte uma data-only (`YYYY-MM-DD`, ex.: de `<input type="date">`) no
 * instante do FINAL daquele dia (23:59:59.999) no fuso horário LOCAL do
 * runtime — nunca `new Date("YYYY-MM-DD").toISOString()`, que a spec
 * ECMA-262 interpreta como meia-noite UTC (não local), produzindo um
 * instante que já pode estar no passado dependendo do fuso e da hora atual.
 *
 * Usado quando o usuário escolhe só uma DATA para expressar "válido durante
 * todo aquele dia" (ex.: `benefit_grants.expires_at` no formulário de
 * cortesia) — a mesma convenção implícita de fuso local já usada em toda a
 * formatação de exibição do produto (`toLocaleDateString('pt-BR')`,
 * `Intl.DateTimeFormat('pt-BR')`, sem fuso IANA fixo).
 */
export function endOfDayLocalISOString(dateOnly: string): string {
  const [year, month, day] = dateOnly.split('-').map(Number)
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString()
}
