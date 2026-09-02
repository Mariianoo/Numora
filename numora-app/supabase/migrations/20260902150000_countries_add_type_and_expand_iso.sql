-- ============================================================================
-- Countries 2.0 — Etapa 1 (fundação do futuro Numora Catalog).
--
-- `public.countries` continua sendo a tabela de GEOGRAFIA MODERNA (nunca
-- emissores históricos — isso é responsabilidade futura de `issuers`,
-- ainda não criada). Esta migration:
--   1. Adiciona `type` (text + CHECK, seguindo a convenção do projeto —
--      nunca CREATE TYPE ... AS ENUM, mesmo padrão de `role`, `plan_tier`,
--      `passport_collection_visibility`).
--   2. Classifica as 65 linhas já existentes como 'sovereign_state' — via
--      DEFAULT da coluna nova, sem precisar de UPDATE explícito.
--   3. Expande o catálogo para cobertura completa dos Estados soberanos
--      ISO 3166-1 (193 membros da ONU + Vaticano + Palestina, que o
--      próprio ISO 3166-1 já trata como entidade com código próprio) e
--      adiciona territórios/dependências modernos com relevância
--      numismática real (têm ou já tiveram cunhagem própria, ou população
--      residente real que poderia se cadastrar como colecionador).
--
-- NÃO adicionado nesta migration (documentado no relatório da etapa, não
-- decidido silenciosamente):
--   - Taiwan (TW), Saara Ocidental (EH), Ilhas Malvinas/Falkland (FK) —
--     soberania disputada, classificação como sovereign_state/dependency
--     é uma decisão de produto sensível, não uma escolha técnica.
--   - Kosovo — não possui código oficial no ISO 3166-1 (XK é um código de
--     uso não-oficial adotado por algumas organizações, não parte do
--     padrão).
--   - Território Britânico do Oceano Índico (IO), Ilhas Geórgia do Sul e
--     Sandwich do Sul (GS), Ilha Bouvet (BV), Terras Austrais e
--     Antárticas Francesas (TF), Ilhas Heard e McDonald (HM), Antártida
--     (AQ), Ilhas Menores Distantes dos EUA (UM) — sem população
--     residente permanente civil e sem relevância numismática conhecida;
--     excluídos por não servirem a nenhum dos dois casos de uso reais de
--     `countries` (residência de usuário / país emissor de moeda).
--   - Qualquer entidade histórica (URSS, Império Otomano, Áustria-
--     Hungria, Prússia etc.) — nunca pertence a esta tabela.
--
-- `ON CONFLICT (code) DO NOTHING` — mesmo padrão idempotente do seed
-- original (20260812090100_seed_reference_tables.sql), que esta migration
-- NÃO edita nem substitui (histórico já aplicado permanece intocado).
-- ============================================================================

alter table public.countries
  add column type text not null default 'sovereign_state'
  check (type in ('sovereign_state', 'dependency', 'special_region'));

comment on column public.countries.type is
  'Classificação de geografia MODERNA — nunca emissor histórico (ver issuers, futuro). sovereign_state = Estado soberano atual. dependency = território dependente de um Estado soberano, com população residente real (ex.: Porto Rico, Groenlândia, Bermudas). special_region = região com estatuto constitucional próprio distinto de uma dependência comum (ex.: Hong Kong e Macau, regiões administrativas especiais; Ilhas Åland, região autônoma). Perfil/Cadastro do usuário usa só sovereign_state (ver ReferenceRepository.listResidenceCountries); Cadastro de moeda usa todos os tipos (ver ReferenceRepository.listCountries).';

-- ----------------------------------------------------------------------------
-- Estados soberanos — África (49 adicionados; 5 já existiam: EG, KE, MA, NG, ZA)
-- ----------------------------------------------------------------------------
insert into public.countries (code, name, flag_emoji, type) values
  ('DZ', 'Argélia', '🇩🇿', 'sovereign_state'),
  ('AO', 'Angola', '🇦🇴', 'sovereign_state'),
  ('BJ', 'Benin', '🇧🇯', 'sovereign_state'),
  ('BW', 'Botsuana', '🇧🇼', 'sovereign_state'),
  ('BF', 'Burkina Faso', '🇧🇫', 'sovereign_state'),
  ('BI', 'Burundi', '🇧🇮', 'sovereign_state'),
  ('CV', 'Cabo Verde', '🇨🇻', 'sovereign_state'),
  ('CM', 'Camarões', '🇨🇲', 'sovereign_state'),
  ('CF', 'República Centro-Africana', '🇨🇫', 'sovereign_state'),
  ('TD', 'Chade', '🇹🇩', 'sovereign_state'),
  ('KM', 'Comores', '🇰🇲', 'sovereign_state'),
  ('CG', 'Congo', '🇨🇬', 'sovereign_state'),
  ('CD', 'República Democrática do Congo', '🇨🇩', 'sovereign_state'),
  ('CI', 'Costa do Marfim', '🇨🇮', 'sovereign_state'),
  ('DJ', 'Djibuti', '🇩🇯', 'sovereign_state'),
  ('GQ', 'Guiné Equatorial', '🇬🇶', 'sovereign_state'),
  ('ER', 'Eritreia', '🇪🇷', 'sovereign_state'),
  ('SZ', 'Essuatíni', '🇸🇿', 'sovereign_state'),
  ('ET', 'Etiópia', '🇪🇹', 'sovereign_state'),
  ('GA', 'Gabão', '🇬🇦', 'sovereign_state'),
  ('GM', 'Gâmbia', '🇬🇲', 'sovereign_state'),
  ('GH', 'Gana', '🇬🇭', 'sovereign_state'),
  ('GN', 'Guiné', '🇬🇳', 'sovereign_state'),
  ('GW', 'Guiné-Bissau', '🇬🇼', 'sovereign_state'),
  ('LS', 'Lesoto', '🇱🇸', 'sovereign_state'),
  ('LR', 'Libéria', '🇱🇷', 'sovereign_state'),
  ('LY', 'Líbia', '🇱🇾', 'sovereign_state'),
  ('MG', 'Madagascar', '🇲🇬', 'sovereign_state'),
  ('MW', 'Malawi', '🇲🇼', 'sovereign_state'),
  ('ML', 'Mali', '🇲🇱', 'sovereign_state'),
  ('MR', 'Mauritânia', '🇲🇷', 'sovereign_state'),
  ('MU', 'Maurícia', '🇲🇺', 'sovereign_state'),
  ('MZ', 'Moçambique', '🇲🇿', 'sovereign_state'),
  ('NA', 'Namíbia', '🇳🇦', 'sovereign_state'),
  ('NE', 'Níger', '🇳🇪', 'sovereign_state'),
  ('RW', 'Ruanda', '🇷🇼', 'sovereign_state'),
  ('ST', 'São Tomé e Príncipe', '🇸🇹', 'sovereign_state'),
  ('SN', 'Senegal', '🇸🇳', 'sovereign_state'),
  ('SC', 'Seicheles', '🇸🇨', 'sovereign_state'),
  ('SL', 'Serra Leoa', '🇸🇱', 'sovereign_state'),
  ('SO', 'Somália', '🇸🇴', 'sovereign_state'),
  ('SS', 'Sudão do Sul', '🇸🇸', 'sovereign_state'),
  ('SD', 'Sudão', '🇸🇩', 'sovereign_state'),
  ('TZ', 'Tanzânia', '🇹🇿', 'sovereign_state'),
  ('TG', 'Togo', '🇹🇬', 'sovereign_state'),
  ('TN', 'Tunísia', '🇹🇳', 'sovereign_state'),
  ('UG', 'Uganda', '🇺🇬', 'sovereign_state'),
  ('ZM', 'Zâmbia', '🇿🇲', 'sovereign_state'),
  ('ZW', 'Zimbábue', '🇿🇼', 'sovereign_state')
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- Estados soberanos — Américas (21 adicionados, inclui Panamá — obrigatório)
-- ----------------------------------------------------------------------------
insert into public.countries (code, name, flag_emoji, type) values
  ('PA', 'Panamá', '🇵🇦', 'sovereign_state'),
  ('BZ', 'Belize', '🇧🇿', 'sovereign_state'),
  ('CR', 'Costa Rica', '🇨🇷', 'sovereign_state'),
  ('SV', 'El Salvador', '🇸🇻', 'sovereign_state'),
  ('GT', 'Guatemala', '🇬🇹', 'sovereign_state'),
  ('HN', 'Honduras', '🇭🇳', 'sovereign_state'),
  ('NI', 'Nicarágua', '🇳🇮', 'sovereign_state'),
  ('AG', 'Antígua e Barbuda', '🇦🇬', 'sovereign_state'),
  ('BS', 'Bahamas', '🇧🇸', 'sovereign_state'),
  ('BB', 'Barbados', '🇧🇧', 'sovereign_state'),
  ('DM', 'Dominica', '🇩🇲', 'sovereign_state'),
  ('DO', 'República Dominicana', '🇩🇴', 'sovereign_state'),
  ('GD', 'Granada', '🇬🇩', 'sovereign_state'),
  ('HT', 'Haiti', '🇭🇹', 'sovereign_state'),
  ('JM', 'Jamaica', '🇯🇲', 'sovereign_state'),
  ('KN', 'São Cristóvão e Névis', '🇰🇳', 'sovereign_state'),
  ('LC', 'Santa Lúcia', '🇱🇨', 'sovereign_state'),
  ('VC', 'São Vicente e Granadinas', '🇻🇨', 'sovereign_state'),
  ('TT', 'Trinidad e Tobago', '🇹🇹', 'sovereign_state'),
  ('GY', 'Guiana', '🇬🇾', 'sovereign_state'),
  ('SR', 'Suriname', '🇸🇷', 'sovereign_state')
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- Estados soberanos — Europa (19 adicionados)
-- ----------------------------------------------------------------------------
insert into public.countries (code, name, flag_emoji, type) values
  ('AL', 'Albânia', '🇦🇱', 'sovereign_state'),
  ('AD', 'Andorra', '🇦🇩', 'sovereign_state'),
  ('BY', 'Bielorrússia', '🇧🇾', 'sovereign_state'),
  ('BA', 'Bósnia e Herzegovina', '🇧🇦', 'sovereign_state'),
  ('CY', 'Chipre', '🇨🇾', 'sovereign_state'),
  ('EE', 'Estônia', '🇪🇪', 'sovereign_state'),
  ('LV', 'Letônia', '🇱🇻', 'sovereign_state'),
  ('LI', 'Liechtenstein', '🇱🇮', 'sovereign_state'),
  ('LT', 'Lituânia', '🇱🇹', 'sovereign_state'),
  ('LU', 'Luxemburgo', '🇱🇺', 'sovereign_state'),
  ('MT', 'Malta', '🇲🇹', 'sovereign_state'),
  ('MD', 'Moldávia', '🇲🇩', 'sovereign_state'),
  ('MC', 'Mônaco', '🇲🇨', 'sovereign_state'),
  ('ME', 'Montenegro', '🇲🇪', 'sovereign_state'),
  ('MK', 'Macedônia do Norte', '🇲🇰', 'sovereign_state'),
  ('SM', 'San Marino', '🇸🇲', 'sovereign_state'),
  ('SK', 'Eslováquia', '🇸🇰', 'sovereign_state'),
  ('SI', 'Eslovênia', '🇸🇮', 'sovereign_state'),
  ('VA', 'Vaticano', '🇻🇦', 'sovereign_state')
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- Estados soberanos — Ásia e Oriente Médio (29 adicionados)
-- ----------------------------------------------------------------------------
insert into public.countries (code, name, flag_emoji, type) values
  ('AF', 'Afeganistão', '🇦🇫', 'sovereign_state'),
  ('AM', 'Armênia', '🇦🇲', 'sovereign_state'),
  ('AZ', 'Azerbaijão', '🇦🇿', 'sovereign_state'),
  ('BH', 'Bahrein', '🇧🇭', 'sovereign_state'),
  ('BD', 'Bangladesh', '🇧🇩', 'sovereign_state'),
  ('BT', 'Butão', '🇧🇹', 'sovereign_state'),
  ('BN', 'Brunei', '🇧🇳', 'sovereign_state'),
  ('KH', 'Camboja', '🇰🇭', 'sovereign_state'),
  ('GE', 'Geórgia', '🇬🇪', 'sovereign_state'),
  ('JO', 'Jordânia', '🇯🇴', 'sovereign_state'),
  ('KZ', 'Cazaquistão', '🇰🇿', 'sovereign_state'),
  ('KW', 'Kuwait', '🇰🇼', 'sovereign_state'),
  ('KG', 'Quirguistão', '🇰🇬', 'sovereign_state'),
  ('LA', 'Laos', '🇱🇦', 'sovereign_state'),
  ('LB', 'Líbano', '🇱🇧', 'sovereign_state'),
  ('MV', 'Maldivas', '🇲🇻', 'sovereign_state'),
  ('MN', 'Mongólia', '🇲🇳', 'sovereign_state'),
  ('MM', 'Mianmar', '🇲🇲', 'sovereign_state'),
  ('NP', 'Nepal', '🇳🇵', 'sovereign_state'),
  ('OM', 'Omã', '🇴🇲', 'sovereign_state'),
  ('PS', 'Palestina', '🇵🇸', 'sovereign_state'),
  ('QA', 'Catar', '🇶🇦', 'sovereign_state'),
  ('LK', 'Sri Lanka', '🇱🇰', 'sovereign_state'),
  ('SY', 'Síria', '🇸🇾', 'sovereign_state'),
  ('TJ', 'Tajiquistão', '🇹🇯', 'sovereign_state'),
  ('TL', 'Timor-Leste', '🇹🇱', 'sovereign_state'),
  ('TM', 'Turcomenistão', '🇹🇲', 'sovereign_state'),
  ('UZ', 'Uzbequistão', '🇺🇿', 'sovereign_state'),
  ('YE', 'Iêmen', '🇾🇪', 'sovereign_state')
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- Estados soberanos — Oceania (12 adicionados)
-- ----------------------------------------------------------------------------
insert into public.countries (code, name, flag_emoji, type) values
  ('FJ', 'Fiji', '🇫🇯', 'sovereign_state'),
  ('PG', 'Papua-Nova Guiné', '🇵🇬', 'sovereign_state'),
  ('WS', 'Samoa', '🇼🇸', 'sovereign_state'),
  ('SB', 'Ilhas Salomão', '🇸🇧', 'sovereign_state'),
  ('TO', 'Tonga', '🇹🇴', 'sovereign_state'),
  ('VU', 'Vanuatu', '🇻🇺', 'sovereign_state'),
  ('KI', 'Kiribati', '🇰🇮', 'sovereign_state'),
  ('FM', 'Micronésia', '🇫🇲', 'sovereign_state'),
  ('MH', 'Ilhas Marshall', '🇲🇭', 'sovereign_state'),
  ('NR', 'Nauru', '🇳🇷', 'sovereign_state'),
  ('PW', 'Palau', '🇵🇼', 'sovereign_state'),
  ('TV', 'Tuvalu', '🇹🇻', 'sovereign_state')
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- Dependências — territórios com população residente real e/ou cunhagem
-- numismática própria (não são Estados soberanos, mas colecionador pode
-- morar lá E moeda pode ter sido emitida por eles).
-- ----------------------------------------------------------------------------
insert into public.countries (code, name, flag_emoji, type) values
  ('PR', 'Porto Rico', '🇵🇷', 'dependency'),
  ('VI', 'Ilhas Virgens Americanas', '🇻🇮', 'dependency'),
  ('VG', 'Ilhas Virgens Britânicas', '🇻🇬', 'dependency'),
  ('KY', 'Ilhas Cayman', '🇰🇾', 'dependency'),
  ('TC', 'Ilhas Turcas e Caicos', '🇹🇨', 'dependency'),
  ('AI', 'Anguilla', '🇦🇮', 'dependency'),
  ('MS', 'Montserrat', '🇲🇸', 'dependency'),
  ('BM', 'Bermudas', '🇧🇲', 'dependency'),
  ('GI', 'Gibraltar', '🇬🇮', 'dependency'),
  ('SH', 'Santa Helena', '🇸🇭', 'dependency'),
  ('AW', 'Aruba', '🇦🇼', 'dependency'),
  ('CW', 'Curaçao', '🇨🇼', 'dependency'),
  ('SX', 'Sint Maarten', '🇸🇽', 'dependency'),
  ('GL', 'Groenlândia', '🇬🇱', 'dependency'),
  ('FO', 'Ilhas Faroé', '🇫🇴', 'dependency'),
  ('GF', 'Guiana Francesa', '🇬🇫', 'dependency'),
  ('GP', 'Guadalupe', '🇬🇵', 'dependency'),
  ('MQ', 'Martinica', '🇲🇶', 'dependency'),
  ('RE', 'Reunião', '🇷🇪', 'dependency'),
  ('YT', 'Mayotte', '🇾🇹', 'dependency'),
  ('BL', 'São Bartolomeu', '🇧🇱', 'dependency'),
  ('MF', 'São Martinho', '🇲🇫', 'dependency'),
  ('PM', 'Saint-Pierre e Miquelon', '🇵🇲', 'dependency'),
  ('NC', 'Nova Caledônia', '🇳🇨', 'dependency'),
  ('PF', 'Polinésia Francesa', '🇵🇫', 'dependency'),
  ('WF', 'Wallis e Futuna', '🇼🇫', 'dependency'),
  ('GU', 'Guam', '🇬🇺', 'dependency'),
  ('AS', 'Samoa Americana', '🇦🇸', 'dependency'),
  ('MP', 'Ilhas Marianas do Norte', '🇲🇵', 'dependency'),
  ('CK', 'Ilhas Cook', '🇨🇰', 'dependency'),
  ('NU', 'Niue', '🇳🇺', 'dependency'),
  ('TK', 'Tokelau', '🇹🇰', 'dependency'),
  ('NF', 'Ilha Norfolk', '🇳🇫', 'dependency'),
  ('PN', 'Ilhas Pitcairn', '🇵🇳', 'dependency'),
  ('CX', 'Ilha Christmas', '🇨🇽', 'dependency'),
  ('CC', 'Ilhas Cocos (Keeling)', '🇨🇨', 'dependency'),
  ('IM', 'Ilha de Man', '🇮🇲', 'dependency'),
  ('JE', 'Jersey', '🇯🇪', 'dependency'),
  ('GG', 'Guernsey', '🇬🇬', 'dependency')
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- Regiões especiais — estatuto constitucional próprio, distinto de uma
-- dependência comum (Hong Kong/Macau: regiões administrativas especiais,
-- com moeda e emissão numismática próprias; Åland/Svalbard: regiões
-- autônomas com estatuto de tratado próprio).
-- ----------------------------------------------------------------------------
insert into public.countries (code, name, flag_emoji, type) values
  ('HK', 'Hong Kong', '🇭🇰', 'special_region'),
  ('MO', 'Macau', '🇲🇴', 'special_region'),
  ('AX', 'Ilhas Åland', '🇦🇽', 'special_region'),
  ('SJ', 'Svalbard e Jan Mayen', '🇸🇯', 'special_region')
on conflict (code) do nothing;
