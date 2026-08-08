/**
 * app/page.tsx
 * Placeholder de infraestrutura da Sprint Foundation.
 *
 * IMPORTANTE: esta página NÃO é uma tela de produto. Ela existe apenas para
 * validar que o app compila, renderiza e que os Providers (Query, Theme,
 * Toast, i18n) estão corretamente encadeados. Nenhuma tela de negócio,
 * autenticação ou fluxo de produto é implementada nesta sprint
 * (PRODUCT_BIBLE.md / FEATURE_CATALOG.md definem esse escopo para sprints
 * seguintes).
 */
export default function InfrastructureStatusPage() {
  return (
    <main style={{ padding: 'var(--space-xl)' }}>
      <h1>Numora — Sprint Foundation</h1>
      <p style={{ color: 'var(--color-text-secondary)' }}>
        Infraestrutura de projeto ativa. Nenhuma funcionalidade de produto
        implementada ainda.
      </p>
    </main>
  )
}
