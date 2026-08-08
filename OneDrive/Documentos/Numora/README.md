# Numora — Monorepo

SaaS PWA para colecionadores de moedas, cédulas, medalhas e tokens.

Este repositório contém a implementação da **Sprint Foundation**: infraestrutura de
projeto, sem autenticação, telas ou regras de negócio (ver `DEVELOPMENT_GUIDE.md`
e `PROJECT_RULES.md` na documentação do produto para o contrato completo).

## Estrutura

```
numora/
├── apps/
│   └── web/          # Aplicação Next.js (PWA)
├── packages/
│   └── config/        # Configurações compartilhadas (ESLint, TSConfig)
├── .github/workflows/  # CI/CD
└── .husky/             # Git hooks
```

## Requisitos

- Node.js 20+
- pnpm 9+

## Começando

```bash
pnpm install
pnpm dev
```

## Scripts principais

| Script | Descrição |
|---|---|
| `pnpm dev` | Inicia o app web em modo desenvolvimento |
| `pnpm build` | Build de produção |
| `pnpm lint` | Lint em todos os pacotes |
| `pnpm typecheck` | Checagem de tipos em todos os pacotes |
| `pnpm test` | Testes unitários/integração (Vitest) |
| `pnpm test:e2e` | Testes E2E (Playwright) |
| `pnpm storybook` | Storybook do design system |

Convenções completas de desenvolvimento: ver `DEVELOPMENT_GUIDE.md`.
