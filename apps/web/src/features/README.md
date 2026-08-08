# features/

Cada domínio de negócio (collection, catalog, marketplace, trades, ai, etc.)
ganha uma pasta própria aqui, no formato:

```
features/<dominio>/
├── components/
├── hooks/
├── services/       # Application layer
├── repositories/    # Infrastructure layer (implementações)
├── domain/          # Entidades e regras puras
├── schemas/          # Zod schemas
└── types.ts
```

Nenhuma feature de domínio é criada nesta Sprint Foundation — apenas a
convenção de estrutura está preparada (item 30, arquitetura pronta para
módulos). Ver `PROJECT_RULES.md` §5 e `DEVELOPMENT_GUIDE.md` §10–15.
