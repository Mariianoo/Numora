# FEATURE_CATALOG.md — Numisphere

> **Papel deste documento:** catálogo exaustivo de funcionalidades do sistema, unidade mínima de planejamento para PM/Design/Dev/QA. Subordinado a `PROJECT_RULES.md`, `ARCHITECTURE.md`, `DATABASE.md`, `API_SPEC.yaml`, `PRODUCT_BIBLE.md` e `UX_BIBLE.md` — nenhum documento anterior é alterado; este catálogo referencia-os por nome em vez de repetir seu conteúdo.
> **Unidade de catalogação:** uma "funcionalidade" é a menor unidade de valor entregável e testável isoladamente (ex.: "Login por e-mail/senha" é uma funcionalidade; "Autenticação" é o módulo que a contém).
> **Status:** Lote 1 de N. Ver nota de progresso ao final.

---

## Convenções deste documento

- **ID:** prefixo do módulo + número sequencial de 3 dígitos (`AUTH-001`, `COL-001`, `SCAN-001`, `AI-001`...).
- **Prioridade:** `P0` (bloqueante de lançamento) · `P1` (essencial, pode seguir P0 de perto) · `P2` (importante, não bloqueante) · `P3` (desejável).
- **Status:** `Planejado` · `Em especificação` · `Em desenvolvimento` · `Em QA` · `Concluído` — todas as funcionalidades deste catálogo iniciam como `Planejado` (documento de especificação, não de execução).
- **Complexidade:** `Baixa` · `Média` · `Alta` · `Muito Alta` — estimativa qualitativa de esforço de engenharia, considerando back-end + front-end + QA.
- **Plano necessário:** conforme `subscription_tier` (`DATABASE.md`) — `free` · `premium` · `pro` · `Todos`.
- **Endpoints utilizados:** referenciam as tags/operações de `API_SPEC.yaml`.
- **Tabelas utilizadas:** referenciam as tabelas de `DATABASE.md`.
- **Componentes envolvidos:** referenciam os padrões de `UX_BIBLE.md` (seção 42 e correlatas) — nomes genéricos de componente, nunca código.
- **Logs necessários:** referenciam `audit_logs`/`system_logs`/`error_logs` (`DATABASE.md` §6) e a política de logs de `PROJECT_RULES.md` §17.
- **Eventos gerados:** nome semântico do evento de analytics (`user_events` — `DATABASE.md` Módulo P), usado por Analytics/Gamificação.

---

# MÓDULO: Autenticação

## AUTH-001 — Cadastro por e-mail/senha
- **Descrição:** criação de conta com e-mail, senha, username e nome de exibição.
- **Objetivo:** converter um visitante em usuário autenticado com a menor fricção possível.
- **Prioridade:** P0
- **Dependências:** nenhuma (funcionalidade fundacional).
- **Usuários com acesso:** Visitante.
- **Plano necessário:** Todos (gera plano `free`).
- **Status:** Planejado
- **Complexidade:** Média
- **Critérios de aceite:** ver `PRODUCT_BIBLE.md` Módulo Cadastro.
- **Casos de uso:** CU01–CU14 (todos dependem de conta existente).
- **Fluxos relacionados:** `PRODUCT_BIBLE.md` §2 (Cadastro).
- **Endpoints utilizados:** `POST /auth/register` (tag Authentication).
- **Tabelas utilizadas:** `auth.users` (Supabase Auth), `profiles`.
- **Componentes envolvidos:** Formulário (padrão de Formulários, `UX_BIBLE.md` §49), Botão primário, Indicador de força de senha.
- **Permissões:** pública (sem autenticação prévia).
- **Logs necessários:** `audit_logs` (`action=insert`, `entity_type=profiles`).
- **Eventos gerados:** `user_registered`.
- **Notificações:** e-mail transacional de verificação.
- **Integrações:** Supabase Auth.
- **Métricas:** taxa de conclusão do formulário, tempo médio até conclusão.
- **KPIs:** cadastros/dia, taxa de ativação D1 (usuário que cadastra e adiciona 1º item no mesmo dia).

## AUTH-002 — Cadastro social (Google/Apple)
- **Descrição:** criação de conta via OAuth, com escolha de username como único passo adicional.
- **Objetivo:** reduzir ainda mais a fricção de cadastro para quem já usa login social no dia a dia.
- **Prioridade:** P1
- **Dependências:** AUTH-001 (reaproveita criação de `profiles`).
- **Usuários com acesso:** Visitante.
- **Plano necessário:** Todos.
- **Status:** Planejado
- **Complexidade:** Média
- **Critérios de aceite:** `PRODUCT_BIBLE.md` §2, fluxo alternativo "Cadastro social".
- **Casos de uso:** CU01–CU14.
- **Fluxos relacionados:** `PRODUCT_BIBLE.md` §2.
- **Endpoints utilizados:** `POST /auth/register` (variante OAuth, mesma operação com provider).
- **Tabelas utilizadas:** `auth.users`, `profiles`.
- **Componentes envolvidos:** Botão de login social, Formulário mínimo (username).
- **Permissões:** pública.
- **Logs necessários:** `audit_logs`.
- **Eventos gerados:** `user_registered` (com `properties.method=oauth`).
- **Notificações:** nenhuma adicional (e-mail já verificado pelo provedor).
- **Integrações:** Google OAuth, Apple Sign-In, Supabase Auth.
- **Métricas:** % de cadastros via social vs. e-mail.
- **KPIs:** cadastros/dia por canal.

## AUTH-003 — Login por e-mail/senha
- **Descrição:** autenticação de usuário existente, com suporte a MFA quando ativo.
- **Objetivo:** acesso seguro e rápido à conta.
- **Prioridade:** P0
- **Dependências:** AUTH-001.
- **Usuários com acesso:** Visitante com conta existente.
- **Plano necessário:** Todos.
- **Status:** Planejado
- **Complexidade:** Média
- **Critérios de aceite:** `PRODUCT_BIBLE.md` §3.
- **Casos de uso:** CU01–CU14.
- **Fluxos relacionados:** `PRODUCT_BIBLE.md` §3.
- **Endpoints utilizados:** `POST /auth/login`.
- **Tabelas utilizadas:** `auth.users`, `profiles`, `user_sessions`.
- **Componentes envolvidos:** Formulário, Campo de senha com visibilidade alternável.
- **Permissões:** pública.
- **Logs necessários:** `audit_logs` (`action=login`).
- **Eventos gerados:** `user_logged_in`.
- **Notificações:** nenhuma (exceto alerta de novo dispositivo — ver AUTH-011).
- **Integrações:** Supabase Auth.
- **Métricas:** taxa de erro de login, tempo até autenticação.
- **KPIs:** DAU/MAU derivados de eventos de login.

## AUTH-004 — Login social
- **Descrição:** autenticação via provedor OAuth já vinculado à conta.
- **Objetivo:** acesso em 1 toque.
- **Prioridade:** P1
- **Dependências:** AUTH-002.
- **Usuários com acesso:** Visitante com conta vinculada a provedor social.
- **Plano necessário:** Todos.
- **Status:** Planejado
- **Complexidade:** Baixa
- **Critérios de aceite:** login social completa em 1 toque para conta existente.
- **Casos de uso:** CU01–CU14.
- **Fluxos relacionados:** `PRODUCT_BIBLE.md` §3.
- **Endpoints utilizados:** `POST /auth/login` (variante OAuth).
- **Tabelas utilizadas:** `auth.users`, `profiles`, `user_sessions`.
- **Componentes envolvidos:** Botão de login social.
- **Permissões:** pública.
- **Logs necessários:** `audit_logs`.
- **Eventos gerados:** `user_logged_in` (`properties.method=oauth`).
- **Notificações:** nenhuma.
- **Integrações:** Google OAuth, Apple Sign-In.
- **Métricas:** % de logins via social.
- **KPIs:** DAU/MAU por canal de login.

## AUTH-005 — Refresh de sessão
- **Descrição:** renovação silenciosa do access token via refresh token, com rotação.
- **Objetivo:** manter o usuário logado sem exigir novo login constantemente, com segurança.
- **Prioridade:** P0
- **Dependências:** AUTH-003.
- **Usuários com acesso:** Sistema (transparente ao usuário).
- **Plano necessário:** Todos.
- **Status:** Planejado
- **Complexidade:** Média
- **Critérios de aceite:** `API_CONVENTIONS` (anexo à API_SPEC) §3 — rotação a cada uso.
- **Casos de uso:** transversal a todos.
- **Fluxos relacionados:** nenhum fluxo de UI dedicado (automático).
- **Endpoints utilizados:** `POST /auth/refresh`.
- **Tabelas utilizadas:** `auth.users`, `user_sessions`.
- **Componentes envolvidos:** nenhum (invisível ao usuário).
- **Permissões:** posse de refresh token válido.
- **Logs necessários:** `system_logs` (falhas de refresh).
- **Eventos gerados:** nenhum (não é ação de usuário).
- **Notificações:** nenhuma.
- **Integrações:** Supabase Auth.
- **Métricas:** taxa de falha de refresh.
- **KPIs:** nenhum direto (suporte a retenção de sessão).

## AUTH-006 — Logout (sessão atual)
- **Descrição:** encerramento da sessão corrente.
- **Objetivo:** permitir saída segura e intencional.
- **Prioridade:** P0
- **Dependências:** AUTH-003.
- **Usuários com acesso:** Usuário autenticado.
- **Plano necessário:** Todos.
- **Status:** Planejado
- **Complexidade:** Baixa
- **Critérios de aceite:** sessão revogada, tokens invalidados.
- **Casos de uso:** transversal.
- **Fluxos relacionados:** Perfil (menu de conta).
- **Endpoints utilizados:** `POST /auth/logout`.
- **Tabelas utilizadas:** `user_sessions`.
- **Componentes envolvidos:** Item de menu, Diálogo de confirmação.
- **Permissões:** usuário autenticado (própria sessão).
- **Logs necessários:** `audit_logs` (`action=logout`).
- **Eventos gerados:** `user_logged_out`.
- **Notificações:** nenhuma.
- **Integrações:** Supabase Auth.
- **Métricas:** nenhuma direta.
- **KPIs:** nenhum direto.

## AUTH-007 — Logout de todos os dispositivos
- **Descrição:** revogação de todas as sessões ativas do usuário.
- **Objetivo:** resposta rápida a suspeita de acesso indevido.
- **Prioridade:** P1
- **Dependências:** AUTH-006.
- **Usuários com acesso:** Usuário autenticado (próprio).
- **Plano necessário:** Todos.
- **Status:** Planejado
- **Complexidade:** Baixa
- **Critérios de aceite:** `PRODUCT_BIBLE.md` — todas as sessões revogadas de imediato.
- **Casos de uso:** segurança de conta.
- **Fluxos relacionados:** Perfil → Segurança.
- **Endpoints utilizados:** `POST /auth/logout-all`.
- **Tabelas utilizadas:** `user_sessions`.
- **Componentes envolvidos:** Item de menu, Diálogo de confirmação, Lista de sessões (ver AUTH-012).
- **Permissões:** usuário autenticado (próprio).
- **Logs necessários:** `audit_logs`.
- **Eventos gerados:** `user_logged_out_all`.
- **Notificações:** e-mail de confirmação da ação.
- **Integrações:** Supabase Auth.
- **Métricas:** frequência de uso (proxy de preocupação com segurança).
- **KPIs:** nenhum direto.

## AUTH-008 — Recuperação de senha
- **Descrição:** fluxo de "esqueci minha senha" com token de uso único.
- **Objetivo:** permitir recuperação de acesso sem intervenção humana, com segurança.
- **Prioridade:** P0
- **Dependências:** AUTH-001.
- **Usuários com acesso:** Visitante.
- **Plano necessário:** Todos.
- **Status:** Planejado
- **Complexidade:** Média
- **Critérios de aceite:** `PRODUCT_BIBLE.md` §3, fluxo alternativo.
- **Casos de uso:** recuperação de conta.
- **Fluxos relacionados:** `PRODUCT_BIBLE.md` §3.
- **Endpoints utilizados:** `POST /auth/password/forgot`, `POST /auth/password/reset`.
- **Tabelas utilizadas:** `auth.users`, `user_sessions` (revogação em massa ao concluir).
- **Componentes envolvidos:** Formulário, Tela de confirmação genérica.
- **Permissões:** pública / posse de token válido.
- **Logs necessários:** `audit_logs`.
- **Eventos gerados:** `password_reset_requested`, `password_reset_completed`.
- **Notificações:** e-mail com link de redefinição; e-mail de confirmação de alteração.
- **Integrações:** Supabase Auth, provedor de e-mail transacional.
- **Métricas:** taxa de conclusão do fluxo.
- **KPIs:** nenhum direto (suporte a retenção).

## AUTH-009 — Verificação de e-mail
- **Descrição:** confirmação do e-mail cadastrado via token enviado no cadastro.
- **Objetivo:** garantir canal de contato válido sem bloquear uso inicial do produto.
- **Prioridade:** P1
- **Dependências:** AUTH-001.
- **Usuários com acesso:** Usuário autenticado com e-mail não verificado.
- **Plano necessário:** Todos.
- **Status:** Planejado
- **Complexidade:** Baixa
- **Critérios de aceite:** e-mail não verificado não bloqueia catalogação (`PRODUCT_BIBLE.md` §2).
- **Casos de uso:** pré-requisito para ações sensíveis futuras (venda).
- **Fluxos relacionados:** Banner de verificação pendente.
- **Endpoints utilizados:** `POST /auth/email/verify`.
- **Tabelas utilizadas:** `auth.users`.
- **Componentes envolvidos:** Banner persistente, Botão de reenvio.
- **Permissões:** posse de token válido.
- **Logs necessários:** `audit_logs`.
- **Eventos gerados:** `email_verified`.
- **Notificações:** e-mail com link de verificação.
- **Integrações:** Supabase Auth.
- **Métricas:** taxa de verificação em 24h/7 dias.
- **KPIs:** % de contas verificadas.

## AUTH-010 — MFA (TOTP)
- **Descrição:** cadastro e verificação de autenticação multifator via aplicativo TOTP.
- **Objetivo:** camada extra de segurança, obrigatória para papéis administrativos (`PROJECT_RULES.md` §15.3).
- **Prioridade:** P1 (P0 para papel `admin`/`verified_seller`).
- **Dependências:** AUTH-003.
- **Usuários com acesso:** Usuário autenticado (próprio); obrigatório para `admin`.
- **Plano necessário:** Todos.
- **Status:** Planejado
- **Complexidade:** Alta
- **Critérios de aceite:** MFA, quando ativo, nunca é contornável (`PRODUCT_BIBLE.md` §3).
- **Casos de uso:** segurança de conta, segurança administrativa.
- **Fluxos relacionados:** Perfil → Segurança.
- **Endpoints utilizados:** `POST /auth/mfa/enroll`, `POST /auth/mfa/verify`.
- **Tabelas utilizadas:** `auth.users` (metadado MFA gerenciado pelo Supabase Auth).
- **Componentes envolvidos:** QR code, Campo de código de 6 dígitos.
- **Permissões:** usuário autenticado (próprio).
- **Logs necessários:** `audit_logs` (`action=permission_change` quando aplicável a admin).
- **Eventos gerados:** `mfa_enabled`, `mfa_verified`.
- **Notificações:** e-mail de confirmação de ativação de MFA.
- **Integrações:** Supabase Auth (TOTP).
- **Métricas:** % de contas com MFA ativo.
- **KPIs:** % de admins com MFA ativo (meta: 100%).

## AUTH-011 — Gestão de dispositivos
- **Descrição:** listagem e remoção de dispositivos reconhecidos (push notifications).
- **Objetivo:** transparência e controle sobre onde a conta está conectada.
- **Prioridade:** P2
- **Dependências:** AUTH-003.
- **Usuários com acesso:** Usuário autenticado (próprio).
- **Plano necessário:** Todos.
- **Status:** Planejado
- **Complexidade:** Baixa
- **Critérios de aceite:** remoção de dispositivo revoga push token associado.
- **Casos de uso:** segurança de conta.
- **Fluxos relacionados:** Perfil → Segurança.
- **Endpoints utilizados:** `GET /users/me/devices`, `DELETE /users/me/devices/{deviceId}`.
- **Tabelas utilizadas:** `user_devices`.
- **Componentes envolvidos:** Lista, Item de lista com ação de remover.
- **Permissões:** usuário autenticado (dono do dispositivo).
- **Logs necessários:** nenhum de auditoria dedicado (baixo risco).
- **Eventos gerados:** `device_removed`.
- **Notificações:** nenhuma.
- **Integrações:** provedor de push notification (Web Push/FCM/APNs).
- **Métricas:** número médio de dispositivos por conta.
- **KPIs:** nenhum direto.

## AUTH-012 — Gestão de sessões ativas
- **Descrição:** listagem de sessões ativas com IP/dispositivo/data e revogação individual.
- **Objetivo:** dar ao usuário visibilidade e controle granular sobre acessos.
- **Prioridade:** P2
- **Dependências:** AUTH-003.
- **Usuários com acesso:** Usuário autenticado (próprio).
- **Plano necessário:** Todos.
- **Status:** Planejado
- **Complexidade:** Baixa
- **Critérios de aceite:** sessão revogada individualmente não afeta as demais.
- **Casos de uso:** segurança de conta.
- **Fluxos relacionados:** Perfil → Segurança.
- **Endpoints utilizados:** `GET /users/me/sessions`, `DELETE /users/me/sessions/{sessionId}`.
- **Tabelas utilizadas:** `user_sessions`, `user_devices`.
- **Componentes envolvidos:** Lista, Item de lista com ação de revogar.
- **Permissões:** usuário autenticado (dono da sessão).
- **Logs necessários:** `audit_logs` (revogação manual).
- **Eventos gerados:** `session_revoked`.
- **Notificações:** nenhuma.
- **Integrações:** Supabase Auth.
- **Métricas:** nenhuma direta.
- **KPIs:** nenhum direto.

---

# MÓDULO: Coleção

## COL-001 — Criar coleção nomeada
- **Descrição:** criação de um agrupamento nomeado ("pasta") de itens.
- **Objetivo:** permitir organização temática/pessoal do acervo.
- **Prioridade:** P1
- **Dependências:** AUTH-003.
- **Usuários com acesso:** Usuário autenticado.
- **Plano necessário:** Todos (limite de quantidade pode variar por plano).
- **Status:** Planejado
- **Complexidade:** Baixa
- **Critérios de aceite:** `PRODUCT_BIBLE.md` §4.
- **Casos de uso:** CU02, CU04.
- **Fluxos relacionados:** `PRODUCT_BIBLE.md` §4.
- **Endpoints utilizados:** `POST /collections`.
- **Tabelas utilizadas:** `collections`.
- **Componentes envolvidos:** Formulário, Botão flutuante de ação.
- **Permissões:** usuário autenticado (será o dono — RN-01).
- **Logs necessários:** `audit_logs`.
- **Eventos gerados:** `collection_created`.
- **Notificações:** nenhuma.
- **Integrações:** nenhuma externa.
- **Métricas:** número médio de coleções por usuário.
- **KPIs:** % de usuários com ≥1 coleção nomeada.

## COL-002 — Editar coleção
- **Descrição:** atualização de nome, descrição, visibilidade e capa de uma coleção.
- **Objetivo:** manter a organização atualizada conforme o acervo evolui.
- **Prioridade:** P1
- **Dependências:** COL-001.
- **Usuários com acesso:** Dono da coleção.
- **Plano necessário:** Todos.
- **Status:** Planejado
- **Complexidade:** Baixa
- **Critérios de aceite:** alteração de visibilidade nunca expõe dado sem confirmação (RN-02).
- **Casos de uso:** CU02.
- **Fluxos relacionados:** `PRODUCT_BIBLE.md` §4.
- **Endpoints utilizados:** `PATCH /collections/{collectionId}`.
- **Tabelas utilizadas:** `collections`.
- **Componentes envolvidos:** Formulário, Toggle de visibilidade.
- **Permissões:** apenas o dono.
- **Logs necessários:** `audit_logs`.
- **Eventos gerados:** `collection_updated`.
- **Notificações:** nenhuma.
- **Integrações:** nenhuma.
- **Métricas:** frequência de edição.
- **KPIs:** nenhum direto.

## COL-003 — Excluir coleção
- **Descrição:** remoção (soft delete) de uma coleção nomeada; itens vinculados são desassociados, não excluídos.
- **Objetivo:** permitir reorganização sem risco de perda de acervo.
- **Prioridade:** P1
- **Dependências:** COL-001.
- **Usuários com acesso:** Dono da coleção.
- **Plano necessário:** Todos.
- **Status:** Planejado
- **Complexidade:** Baixa
- **Critérios de aceite:** itens da coleção excluída permanecem na visão geral (RN-07).
- **Casos de uso:** CU02.
- **Fluxos relacionados:** `PRODUCT_BIBLE.md` §4.
- **Endpoints utilizados:** `DELETE /collections/{collectionId}`.
- **Tabelas utilizadas:** `collections`, `collection_items` (FK `set null`).
- **Componentes envolvidos:** Diálogo de confirmação.
- **Permissões:** apenas o dono.
- **Logs necessários:** `audit_logs`.
- **Eventos gerados:** `collection_deleted`.
- **Notificações:** nenhuma.
- **Integrações:** nenhuma.
- **Métricas:** taxa de exclusão.
- **KPIs:** nenhum direto.

## COL-004 — Listar/visualizar coleções e itens ("Minha Coleção")
- **Descrição:** tela hub com resumo, listagem, busca, filtro e ordenação da coleção do usuário.
- **Objetivo:** ser o centro de gravidade do produto — tela mais visitada.
- **Prioridade:** P0
- **Dependências:** COL-001, COL-005.
- **Usuários com acesso:** Dono (completo); qualquer usuário para conteúdo público.
- **Plano necessário:** Todos.
- **Status:** Planejado
- **Complexidade:** Alta
- **Critérios de aceite:** `PRODUCT_BIBLE.md` §4 — carrega em <2s em 4G; funcional offline.
- **Casos de uso:** CU01–CU04, CU14.
- **Fluxos relacionados:** `PRODUCT_BIBLE.md` §4.
- **Endpoints utilizados:** `GET /collections`, `GET /collections/{collectionId}/items`.
- **Tabelas utilizadas:** `collections`, `collection_items`, `catalog_items`.
- **Componentes envolvidos:** Cards (`UX_BIBLE.md` §38), Lista, Barra de busca/filtro, Skeleton.
- **Permissões:** RLS `collection_items_select_visible`.
- **Logs necessários:** nenhum de auditoria dedicado (leitura).
- **Eventos gerados:** `collection_viewed`.
- **Notificações:** nenhuma.
- **Integrações:** IndexedDB (cache offline).
- **Métricas:** tempo de carregamento, taxa de uso de filtro/busca.
- **KPIs:** DAU na tela "Minha Coleção", tempo médio de sessão.

## COL-005 — Adicionar moeda
- **Descrição:** criação de item de coleção do tipo moeda, via catálogo ou manual.
- **Objetivo:** fluxo central de catalogação — velocidade e confiabilidade máximas.
- **Prioridade:** P0
- **Dependências:** AUTH-003.
- **Usuários com acesso:** Usuário autenticado.
- **Plano necessário:** Todos (limite de itens por plano — RN-06).
- **Status:** Planejado
- **Complexidade:** Alta
- **Critérios de aceite:** `PRODUCT_BIBLE.md` §5 — fluxo completo em <90s no caminho feliz; funciona offline.
- **Casos de uso:** CU01, CU02.
- **Fluxos relacionados:** `PRODUCT_BIBLE.md` §5, §7 (Scanner), §8 (Identificação IA).
- **Endpoints utilizados:** `POST /collection-items`, `GET /catalog/coins` (busca de referência).
- **Tabelas utilizadas:** `collection_items`, `catalog_items`, `item_photos`.
- **Componentes envolvidos:** Formulário multi-etapa, Câmera, Seletor de catálogo.
- **Permissões:** usuário autenticado (item pertence a quem cria — RN-01).
- **Logs necessários:** `audit_logs`.
- **Eventos gerados:** `collection_item_created` (`properties.type=coin`).
- **Notificações:** notificação de "wishlist match" para outros usuários, se aplicável (ver Wishlist, próximo lote).
- **Integrações:** Storage (bucket `coins`), IndexedDB (offline).
- **Métricas:** tempo médio de conclusão, taxa de abandono por etapa.
- **KPIs:** itens catalogados/usuário/semana, taxa de ativação D1.

## COL-006 — Adicionar cédula
- **Descrição:** criação de item de coleção do tipo cédula, com campos específicos de notafilia.
- **Objetivo:** mesmo princípio de COL-005, adaptado ao domínio de cédulas.
- **Prioridade:** P0
- **Dependências:** AUTH-003.
- **Usuários com acesso:** Usuário autenticado.
- **Plano necessário:** Todos (RN-06).
- **Status:** Planejado
- **Complexidade:** Alta
- **Critérios de aceite:** `PRODUCT_BIBLE.md` §6.
- **Casos de uso:** CU01, CU02.
- **Fluxos relacionados:** `PRODUCT_BIBLE.md` §6.
- **Endpoints utilizados:** `POST /collection-items`, `GET /catalog/banknotes`.
- **Tabelas utilizadas:** `collection_items`, `catalog_items`, `item_photos`.
- **Componentes envolvidos:** Formulário multi-etapa, Câmera.
- **Permissões:** usuário autenticado (RN-01).
- **Logs necessários:** `audit_logs`.
- **Eventos gerados:** `collection_item_created` (`properties.type=banknote`).
- **Notificações:** notificação de wishlist match, se aplicável.
- **Integrações:** Storage (bucket `coins`, subpasta específica), IndexedDB.
- **Métricas:** tempo médio de conclusão, % de fichas "incompletas" (sem verso).
- **KPIs:** itens catalogados/usuário/semana.

## COL-007 — Editar item de coleção
- **Descrição:** atualização de qualquer campo editável de um item já catalogado.
- **Objetivo:** manter o acervo atualizado (novo grading, nota, preço estimado).
- **Prioridade:** P0
- **Dependências:** COL-005/COL-006.
- **Usuários com acesso:** Dono do item.
- **Plano necessário:** Todos.
- **Status:** Planejado
- **Complexidade:** Média
- **Critérios de aceite:** edição nunca sobrescreve dado do catálogo mestre (RN-03).
- **Casos de uso:** CU02, CU04.
- **Fluxos relacionados:** `PRODUCT_BIBLE.md` §4–§6.
- **Endpoints utilizados:** `PATCH /collection-items/{itemId}`.
- **Tabelas utilizadas:** `collection_items`.
- **Componentes envolvidos:** Formulário.
- **Permissões:** apenas o dono.
- **Logs necessários:** `audit_logs`.
- **Eventos gerados:** `collection_item_updated`.
- **Notificações:** nenhuma.
- **Integrações:** IndexedDB (offline).
- **Métricas:** frequência de edição por item.
- **KPIs:** nenhum direto.

## COL-008 — Excluir item de coleção
- **Descrição:** remoção (soft delete) de um item.
- **Objetivo:** permitir correção de catalogação indevida com segurança de reversão.
- **Prioridade:** P1
- **Dependências:** COL-005/COL-006.
- **Usuários com acesso:** Dono do item.
- **Plano necessário:** Todos.
- **Status:** Planejado
- **Complexidade:** Baixa
- **Critérios de aceite:** exclusão bloqueada se item vinculado a anúncio ativo (§ Marketplace).
- **Casos de uso:** CU02.
- **Fluxos relacionados:** `PRODUCT_BIBLE.md` §4.
- **Endpoints utilizados:** `DELETE /collection-items/{itemId}`.
- **Tabelas utilizadas:** `collection_items`.
- **Componentes envolvidos:** Diálogo de confirmação.
- **Permissões:** apenas o dono.
- **Logs necessários:** `audit_logs`.
- **Eventos gerados:** `collection_item_deleted`.
- **Notificações:** nenhuma.
- **Integrações:** nenhuma.
- **Métricas:** taxa de exclusão.
- **KPIs:** nenhum direto.

## COL-009 — Definir visibilidade de item
- **Descrição:** alternância entre `private`, `collection_only` e `public` por item.
- **Objetivo:** dar controle granular sobre o que é compartilhado.
- **Prioridade:** P1
- **Dependências:** COL-005/COL-006.
- **Usuários com acesso:** Dono do item.
- **Plano necessário:** Todos.
- **Status:** Planejado
- **Complexidade:** Baixa
- **Critérios de aceite:** padrão sempre `private` na criação (RN-02).
- **Casos de uso:** CU04, CU09.
- **Fluxos relacionados:** COL-007.
- **Endpoints utilizados:** `PATCH /collection-items/{itemId}`.
- **Tabelas utilizadas:** `collection_items`.
- **Componentes envolvidos:** Seletor de visibilidade.
- **Permissões:** apenas o dono.
- **Logs necessários:** `audit_logs` (mudança para `public` é sensível).
- **Eventos gerados:** `collection_item_visibility_changed`.
- **Notificações:** nenhuma.
- **Integrações:** nenhuma.
- **Métricas:** % de itens públicos vs. privados.
- **KPIs:** nenhum direto.

## COL-010 — Galeria de fotos do item
- **Descrição:** upload, visualização e gestão de múltiplas fotos por ângulo (frente/verso/borda).
- **Objetivo:** documentação visual completa e confiável do exemplar.
- **Prioridade:** P0
- **Dependências:** COL-005/COL-006, UPL-001 (Uploads — próximo lote).
- **Usuários com acesso:** Dono do item (escrita); conforme visibilidade (leitura).
- **Plano necessário:** Todos (limite de fotos por item pode variar por plano).
- **Status:** Planejado
- **Complexidade:** Média
- **Critérios de aceite:** `UX_BIBLE.md` — fotografia tratada como conteúdo nobre; nunca cortada sem controle do usuário.
- **Casos de uso:** CU01, CU02.
- **Fluxos relacionados:** `PRODUCT_BIBLE.md` §9 (Galeria).
- **Endpoints utilizados:** `POST /uploads/request-url`, `POST /uploads/{uploadId}/complete`.
- **Tabelas utilizadas:** `item_photos`.
- **Componentes envolvidos:** Grade de fotos, Visualizador em tela cheia.
- **Permissões:** RLS `item_photos_write_owner`/`select_visible`.
- **Logs necessários:** nenhum de auditoria dedicado.
- **Eventos gerados:** `item_photo_added`.
- **Notificações:** nenhuma.
- **Integrações:** Storage (bucket `coins`), pipeline de sanitização de imagem (`PROJECT_RULES.md` §13.5).
- **Métricas:** número médio de fotos por item.
- **KPIs:** % de itens com foto completa (frente+verso).

## COL-011 — Certificados/laudos
- **Descrição:** upload de documentos de autenticidade/grading profissional vinculados a um item.
- **Objetivo:** aumentar a confiança e o valor documental do acervo.
- **Prioridade:** P2
- **Dependências:** COL-005/COL-006.
- **Usuários com acesso:** Dono do item.
- **Plano necessário:** `premium`/`pro` (recurso avançado).
- **Status:** Planejado
- **Complexidade:** Baixa
- **Critérios de aceite:** arquivo nunca público, mesmo se o item for público.
- **Casos de uso:** CU04.
- **Fluxos relacionados:** ficha do item.
- **Endpoints utilizados:** `POST /uploads/request-url` (bucket `certificates`).
- **Tabelas utilizadas:** `certificates`.
- **Componentes envolvidos:** Upload de documento, Visualizador de PDF/imagem.
- **Permissões:** RLS `certificates_all_owner`.
- **Logs necessários:** nenhum dedicado.
- **Eventos gerados:** `certificate_added`.
- **Notificações:** nenhuma.
- **Integrações:** Storage (bucket `certificates`, privado).
- **Métricas:** % de itens `premium` com certificado.
- **KPIs:** nenhum direto (suporte a conversão Premium).

## COL-012 — Histórico de grading
- **Descrição:** registro append-only de avaliações de estado de conservação de um item.
- **Objetivo:** rastreabilidade histórica da condição da peça.
- **Prioridade:** P1
- **Dependências:** COL-005/COL-006.
- **Usuários com acesso:** Dono do item (escrita); conforme visibilidade (leitura).
- **Plano necessário:** Todos.
- **Status:** Planejado
- **Complexidade:** Média
- **Critérios de aceite:** correção de grading é sempre nova linha, nunca sobrescreve a anterior.
- **Casos de uso:** CU02, CU04.
- **Fluxos relacionados:** ficha do item.
- **Endpoints utilizados:** `POST /collection-items/{itemId}/grading-records` (tag Collections).
- **Tabelas utilizadas:** `grading_records`.
- **Componentes envolvidos:** Linha do tempo (timeline), Formulário de nova avaliação.
- **Permissões:** RLS `grading_records_insert_owner`/`select_visible`.
- **Logs necessários:** `audit_logs` (via `fn_audit_trigger` no `insert`).
- **Eventos gerados:** `grading_record_added`.
- **Notificações:** nenhuma.
- **Integrações:** AI-003 (grading assistido por IA, quando aplicável).
- **Métricas:** número médio de avaliações por item.
- **KPIs:** nenhum direto.

## COL-013 — Uso offline da coleção
- **Descrição:** consulta e catalogação de itens sem conexão, com fila de sincronização.
- **Objetivo:** garantir uso confiável em feiras/exposições com conexão ruim.
- **Prioridade:** P0
- **Dependências:** COL-004, COL-005, COL-006.
- **Usuários com acesso:** Usuário autenticado.
- **Plano necessário:** Todos.
- **Status:** Planejado
- **Complexidade:** Muito Alta
- **Critérios de aceite:** `PROJECT_RULES.md` §21 — offline-first parcial; UI comunica estado claramente.
- **Casos de uso:** CU14.
- **Fluxos relacionados:** `PRODUCT_BIBLE.md` §4, RN-05.
- **Endpoints utilizados:** todos os de Collections (chamados pela fila de sincronização ao reconectar).
- **Tabelas utilizadas:** `collection_items`, `item_photos` (espelhadas em IndexedDB local).
- **Componentes envolvidos:** Indicador de status offline/sincronizando.
- **Permissões:** idênticas às operações que a fila representa.
- **Logs necessários:** `system_logs` (falhas de sincronização).
- **Eventos gerados:** `offline_sync_completed`, `offline_sync_failed`.
- **Notificações:** nenhuma (indicador visual apenas).
- **Integrações:** IndexedDB, Service Worker (Workbox).
- **Métricas:** taxa de sucesso de sincronização, tempo médio até sincronizar.
- **KPIs:** % de sessões com uso offline (proxy de uso em campo/feiras).

## COL-014 — Busca e filtros na coleção
- **Descrição:** busca textual e filtros estruturados (tipo, país, material, disponível para troca) dentro da própria coleção.
- **Objetivo:** permitir localizar rapidamente um item em acervos grandes.
- **Prioridade:** P1
- **Dependências:** COL-004.
- **Usuários com acesso:** Dono (na própria coleção); qualquer usuário (em coleção pública de terceiro).
- **Plano necessário:** Todos.
- **Status:** Planejado
- **Complexidade:** Média
- **Critérios de aceite:** `API_CONVENTIONS` §5–§7 (filtros/ordenação/busca).
- **Casos de uso:** CU02, CU04.
- **Fluxos relacionados:** `PRODUCT_BIBLE.md` §4.
- **Endpoints utilizados:** `GET /collections/{collectionId}/items` (com `q`, `filter[...]`, `sort`).
- **Tabelas utilizadas:** `collection_items`.
- **Componentes envolvidos:** Barra de busca, Painel de filtros (`UX_BIBLE.md` §37).
- **Permissões:** RLS `collection_items_select_visible`.
- **Logs necessários:** nenhum.
- **Eventos gerados:** `collection_search_performed`.
- **Notificações:** nenhuma.
- **Integrações:** nenhuma externa.
- **Métricas:** % de sessões que usam busca/filtro.
- **KPIs:** nenhum direto.

## COL-015 — Favoritar item
- **Descrição:** marcação de item (próprio ou de terceiro) como favorito.
- **Objetivo:** acesso rápido a itens de interesse.
- **Prioridade:** P2
- **Dependências:** COL-004, MKT-001 (Marketplace — próximo lote, para favoritar anúncio).
- **Usuários com acesso:** Usuário autenticado.
- **Plano necessário:** Todos.
- **Status:** Planejado
- **Complexidade:** Baixa
- **Critérios de aceite:** `PRODUCT_BIBLE.md` §10 — lista de favoritos sempre privada.
- **Casos de uso:** CU04, CU09.
- **Fluxos relacionados:** `PRODUCT_BIBLE.md` §10.
- **Endpoints utilizados:** `POST /favorites`, `DELETE /favorites/{favoriteId}` (tag Collections/Marketplace).
- **Tabelas utilizadas:** tabela de favoritos (a especificar em `DATABASE.md` — pendente de lote futuro do banco).
- **Componentes envolvidos:** Ícone de favorito (toggle).
- **Permissões:** usuário autenticado; leitura restrita ao próprio dono da lista.
- **Logs necessários:** nenhum.
- **Eventos gerados:** `item_favorited`, `item_unfavorited`.
- **Notificações:** nenhuma direta ao dono do item favoritado (agregado apenas).
- **Integrações:** nenhuma.
- **Métricas:** número médio de favoritos por usuário.
- **KPIs:** nenhum direto.

---

# MÓDULO: Scanner

## SCAN-001 — Captura via câmera
- **Descrição:** abertura da câmera nativa com guia visual de enquadramento para captura de peça.
- **Objetivo:** porta de entrada rápida para catalogação assistida por IA.
- **Prioridade:** P0
- **Dependências:** COL-005/COL-006.
- **Usuários com acesso:** Usuário autenticado.
- **Plano necessário:** Todos.
- **Status:** Planejado
- **Complexidade:** Média
- **Critérios de aceite:** `PRODUCT_BIBLE.md` §7 — captura em <10s de interação.
- **Casos de uso:** CU01.
- **Fluxos relacionados:** `PRODUCT_BIBLE.md` §7.
- **Endpoints utilizados:** nenhum diretamente (captura é client-side; envio ocorre em AI-001).
- **Tabelas utilizadas:** nenhuma diretamente.
- **Componentes envolvidos:** Visor de câmera, Moldura-guia.
- **Permissões:** usuário autenticado; permissão de câmera do dispositivo.
- **Logs necessários:** nenhum.
- **Eventos gerados:** `scanner_opened`, `scanner_photo_captured`.
- **Notificações:** nenhuma.
- **Integrações:** API de câmera do dispositivo (nativa do navegador/PWA).
- **Métricas:** taxa de conclusão de captura após abertura.
- **KPIs:** uso do Scanner vs. catalogação manual direta (%).

## SCAN-002 — Seleção de foto da galeria
- **Descrição:** alternativa à câmera, usando foto já existente no dispositivo.
- **Objetivo:** flexibilidade para peças já fotografadas anteriormente.
- **Prioridade:** P1
- **Dependências:** SCAN-001.
- **Usuários com acesso:** Usuário autenticado.
- **Plano necessário:** Todos.
- **Status:** Planejado
- **Complexidade:** Baixa
- **Critérios de aceite:** mesmo pipeline de validação de qualidade que a captura direta.
- **Casos de uso:** CU01.
- **Fluxos relacionados:** `PRODUCT_BIBLE.md` §7, fluxo alternativo.
- **Endpoints utilizados:** nenhum diretamente.
- **Tabelas utilizadas:** nenhuma diretamente.
- **Componentes envolvidos:** Seletor de arquivo/galeria nativo.
- **Permissões:** usuário autenticado; permissão de acesso a arquivos do dispositivo.
- **Logs necessários:** nenhum.
- **Eventos gerados:** `scanner_photo_selected_from_gallery`.
- **Notificações:** nenhuma.
- **Integrações:** seletor de arquivo nativo do sistema operacional.
- **Métricas:** % de uso galeria vs. câmera.
- **KPIs:** nenhum direto.

## SCAN-003 — Captura offline com fila
- **Descrição:** captura de foto sem conexão, enfileirada para análise de IA assim que a conexão retornar.
- **Objetivo:** não bloquear o fluxo de catalogação por ausência de rede.
- **Prioridade:** P1
- **Dependências:** SCAN-001, COL-013.
- **Usuários com acesso:** Usuário autenticado.
- **Plano necessário:** Todos.
- **Status:** Planejado
- **Complexidade:** Alta
- **Critérios de aceite:** `PRODUCT_BIBLE.md` §7 — usuário pode catalogar manualmente sem esperar a IA.
- **Casos de uso:** CU14.
- **Fluxos relacionados:** `PRODUCT_BIBLE.md` §7.
- **Endpoints utilizados:** `POST /ai/analysis-requests` (enfileirado, chamado ao reconectar).
- **Tabelas utilizadas:** `ai_analysis_requests` (após reconexão).
- **Componentes envolvidos:** Indicador de fila offline.
- **Permissões:** usuário autenticado (próprio).
- **Logs necessários:** `system_logs` (falha de envio pós-reconexão).
- **Eventos gerados:** `scanner_photo_queued_offline`.
- **Notificações:** nenhuma.
- **Integrações:** IndexedDB, Service Worker.
- **Métricas:** tempo médio na fila até sincronizar.
- **KPIs:** nenhum direto.

## SCAN-004 — Validação de qualidade de imagem
- **Descrição:** verificação client-side de nitidez/iluminação antes do envio para análise.
- **Objetivo:** evitar gastar cota de IA (RN-06) com imagem de baixa qualidade, e melhorar taxa de acerto.
- **Prioridade:** P2
- **Dependências:** SCAN-001, SCAN-002.
- **Usuários com acesso:** Usuário autenticado.
- **Plano necessário:** Todos.
- **Status:** Planejado
- **Complexidade:** Média
- **Critérios de aceite:** aviso não-bloqueante — usuário pode prosseguir mesmo com imagem ruim.
- **Casos de uso:** CU01.
- **Fluxos relacionados:** `PRODUCT_BIBLE.md` §7.
- **Endpoints utilizados:** nenhum (processamento 100% client-side).
- **Tabelas utilizadas:** nenhuma.
- **Componentes envolvidos:** Alerta inline não-bloqueante.
- **Permissões:** usuário autenticado.
- **Logs necessários:** nenhum.
- **Eventos gerados:** `scanner_image_quality_warning_shown`.
- **Notificações:** nenhuma.
- **Integrações:** nenhuma (biblioteca client-side de análise de imagem).
- **Métricas:** % de capturas com aviso de qualidade, % que refazem a foto após aviso.
- **KPIs:** correlação entre aviso ignorado e baixa confiança de IA (retroalimenta SCAN-004).

---

# MÓDULO: IA

## AI-001 — Reconhecimento de item por foto
- **Descrição:** análise de foto(s) retornando sugestão(ões) de item de catálogo mestre com nível de confiança.
- **Objetivo:** acelerar catalogação para usuários iniciantes (Persona Marcos).
- **Prioridade:** P0
- **Dependências:** SCAN-001/SCAN-002, catálogo mestre populado (`DATABASE.md` Módulo C).
- **Usuários com acesso:** Usuário autenticado.
- **Plano necessário:** Todos (cota mensal varia por plano — RN-06).
- **Status:** Planejado
- **Complexidade:** Muito Alta
- **Critérios de aceite:** `PRODUCT_BIBLE.md` §8 — RN-09 (IA nunca decide sozinha), confiança sempre visível.
- **Casos de uso:** CU01.
- **Fluxos relacionados:** `PRODUCT_BIBLE.md` §7, §8.
- **Endpoints utilizados:** `POST /ai/analysis-requests`, `GET /ai/analysis-requests/{id}` (tag AI).
- **Tabelas utilizadas:** `ai_analysis_requests`, `ai_analysis_results`, `catalog_items`.
- **Componentes envolvidos:** Tela de resultado com sugestões, Indicador de confiança.
- **Permissões:** usuário autenticado (própria requisição); execução via `service_role` (Edge Function).
- **Logs necessários:** `audit_logs` (opcional, baixo risco); `system_logs` (falhas de processamento).
- **Eventos gerados:** `ai_analysis_requested`, `ai_analysis_completed`, `ai_analysis_failed`.
- **Notificações:** notificação push/in-app quando a análise assíncrona conclui.
- **Integrações:** provedor de modelo de IA/visão computacional (via Edge Function, `PROJECT_RULES.md` §4.4).
- **Métricas:** tempo médio de processamento, taxa de acerto (top-1), distribuição de confiança.
- **KPIs:** % de itens catalogados via IA vs. manual, taxa de aceitação da 1ª sugestão.

## AI-002 — Estimativa de valor
- **Descrição:** faixa de valor estimado (mínimo–máximo) para um item, com base em dados de mercado/catálogo.
- **Objetivo:** dar ao colecionador investidor uma referência de valorização.
- **Prioridade:** P1
- **Dependências:** AI-001.
- **Usuários com acesso:** Usuário autenticado.
- **Plano necessário:** `premium`/`pro` (recurso avançado — limite reduzido/inexistente em `free`).
- **Status:** Planejado
- **Complexidade:** Alta
- **Critérios de aceite:** estimativa sempre exibida como faixa, nunca valor único absoluto; fonte/confiança visível.
- **Casos de uso:** CU04.
- **Fluxos relacionados:** ficha do item, `PRODUCT_BIBLE.md` §8.
- **Endpoints utilizados:** `POST /ai/analysis-requests` (`analysis_type=value_estimate`).
- **Tabelas utilizadas:** `ai_analysis_requests`, `ai_analysis_results`.
- **Componentes envolvidos:** Cartão de estimativa de valor, Gráfico simples de faixa (`UX_BIBLE.md` §43).
- **Permissões:** usuário autenticado (próprio item).
- **Logs necessários:** `system_logs`.
- **Eventos gerados:** `ai_value_estimate_requested`, `ai_value_estimate_completed`.
- **Notificações:** notificação de conclusão (assíncrona).
- **Integrações:** provedor de IA; futura integração de cotação de mercado (`DATABASE.md` §10.1).
- **Métricas:** dispersão entre estimativa e preço real de venda no Marketplace (quando aplicável).
- **KPIs:** taxa de conversão para Premium atribuída a este recurso.

## AI-003 — Avaliação de condição assistida (grading por IA)
- **Descrição:** sugestão de grau de conservação a partir de foto, complementando COL-012.
- **Objetivo:** dar um ponto de partida objetivo para quem não domina escalas de grading.
- **Prioridade:** P2
- **Dependências:** AI-001, COL-012.
- **Usuários com acesso:** Usuário autenticado.
- **Plano necessário:** `premium`/`pro`.
- **Status:** Planejado
- **Complexidade:** Alta
- **Critérios de aceite:** resultado sempre marcado como `graded_by=ai` em `grading_records`, nunca confundido com avaliação profissional.
- **Casos de uso:** CU02.
- **Fluxos relacionados:** COL-012.
- **Endpoints utilizados:** `POST /ai/analysis-requests` (`analysis_type=condition_estimate`).
- **Tabelas utilizadas:** `ai_analysis_requests`, `ai_analysis_results`, `grading_records`.
- **Componentes envolvidos:** Cartão de sugestão de grading, Linha do tempo (COL-012).
- **Permissões:** usuário autenticado (próprio item).
- **Logs necessários:** `system_logs`.
- **Eventos gerados:** `ai_condition_estimate_completed`.
- **Notificações:** notificação de conclusão.
- **Integrações:** provedor de IA.
- **Métricas:** concordância entre grading de IA e grading profissional posterior (quando disponível).
- **KPIs:** nenhum direto (suporte a AI-002/marketplace).

## AI-004 — Verificação de autenticidade (preparado)
- **Descrição:** análise preparatória de sinais de autenticidade/falsificação — capacidade reservada para versão futura (dependente de maturidade de modelo e responsabilidade legal).
- **Objetivo:** reduzir fraude em transações de alto valor.
- **Prioridade:** P3
- **Dependências:** AI-001, volume de dados de treinamento suficiente.
- **Usuários com acesso:** Usuário autenticado (quando lançado); inicialmente restrito a `pro`/verificado.
- **Plano necessário:** `pro`.
- **Status:** Planejado (preparado no schema — `ai_analysis_type=authenticity_check` já existe em `DATABASE.md`, sem ativação de produto).
- **Complexidade:** Muito Alta
- **Critérios de aceite:** resultado sempre acompanhado de disclaimer explícito de que não substitui laudo profissional.
- **Casos de uso:** CU04, CU05 (mitigação de risco em venda de alto valor).
- **Fluxos relacionados:** a especificar em versão futura do `PRODUCT_BIBLE.md`.
- **Endpoints utilizados:** `POST /ai/analysis-requests` (`analysis_type=authenticity_check`) — endpoint já suporta o tipo, funcionalidade de produto não habilitada.
- **Tabelas utilizadas:** `ai_analysis_requests`, `ai_analysis_results`.
- **Componentes envolvidos:** a especificar.
- **Permissões:** a especificar.
- **Logs necessários:** `audit_logs` (ação sensível quando ativada).
- **Eventos gerados:** a especificar.
- **Notificações:** a especificar.
- **Integrações:** provedor de IA especializado (a contratar).
- **Métricas:** a especificar.
- **KPIs:** a especificar — ver matriz de versões ao final (Versão Enterprise).

## AI-005 — Reanálise de item existente
- **Descrição:** disparo de nova análise de IA sobre fotos já cadastradas em um item catalogado manualmente.
- **Objetivo:** permitir que quem catalogou manualmente ainda se beneficie da IA depois.
- **Prioridade:** P2
- **Dependências:** AI-001, COL-005/COL-006, COL-010.
- **Usuários com acesso:** Dono do item.
- **Plano necessário:** Todos (consome cota — RN-06).
- **Status:** Planejado
- **Complexidade:** Média
- **Critérios de aceite:** `PRODUCT_BIBLE.md` §8, fluxo alternativo "Reanalisar item existente".
- **Casos de uso:** CU02.
- **Fluxos relacionados:** ficha do item.
- **Endpoints utilizados:** `POST /ai/analysis-requests` (com `collection_item_id`).
- **Tabelas utilizadas:** `ai_analysis_requests`, `ai_analysis_results`.
- **Componentes envolvidos:** Botão "Reanalisar com IA" na ficha do item.
- **Permissões:** apenas o dono do item.
- **Logs necessários:** `system_logs`.
- **Eventos gerados:** `ai_reanalysis_requested`.
- **Notificações:** notificação de conclusão.
- **Integrações:** provedor de IA.
- **Métricas:** % de itens manuais que recebem reanálise.
- **KPIs:** nenhum direto.

## AI-006 — Cota de uso por plano
- **Descrição:** contabilização e limite de análises de IA consumidas por mês, com aviso proativo ao se aproximar do limite.
- **Objetivo:** sustentabilidade de custo de IA e alavanca de conversão para planos pagos.
- **Prioridade:** P0
- **Dependências:** AI-001, SUB-001 (Assinaturas — próximo lote).
- **Usuários com acesso:** Sistema (aplicado a todo usuário autenticado).
- **Plano necessário:** Todos (o limite em si varia por plano).
- **Status:** Planejado
- **Complexidade:** Média
- **Critérios de aceite:** aviso de limite sempre exibido antes de a ação falhar, nunca como erro surpresa (RN-06).
- **Casos de uso:** CU13.
- **Fluxos relacionados:** `PRODUCT_BIBLE.md` §7 — mensagem de cota esgotada.
- **Endpoints utilizados:** validado internamente em todo `POST /ai/analysis-requests` (Application layer, `PROJECT_RULES.md` §4.2).
- **Tabelas utilizadas:** `ai_analysis_requests` (contagem por período), `user_subscriptions`.
- **Componentes envolvidos:** Indicador de cota restante, Banner de upgrade.
- **Permissões:** usuário autenticado (própria cota).
- **Logs necessários:** nenhum de auditoria dedicado.
- **Eventos gerados:** `ai_quota_warning_shown`, `ai_quota_exceeded`.
- **Notificações:** notificação in-app ao atingir 80% da cota mensal.
- **Integrações:** nenhuma externa.
- **Métricas:** % de usuários `free` que atingem o limite mensal.
- **KPIs:** taxa de conversão Premium originada do gatilho de cota de IA (métrica-chave de monetização).

---

## Nota de progresso (remover ao concluir o documento)

Lote 1 cobre os módulos **Autenticação** (12 funcionalidades), **Coleção** (15 funcionalidades), **Scanner** (4 funcionalidades) e **IA** (6 funcionalidades) — 37 funcionalidades catalogadas.

Pendente para os próximos lotes:
- **Módulos:** Marketplace, Trocas, Chat, Perfil, Administração, Assinaturas, Analytics, Gamificação, Wishlist, Ranking, Notificações, Eventos, Importação, Exportação, API, Segurança, Relatórios.
- **Seção final:** Matriz de funcionalidades por versão (MVP, Versão 1, Versão 2, Versão Enterprise).
