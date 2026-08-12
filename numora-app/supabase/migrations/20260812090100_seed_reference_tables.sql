-- ============================================================================
-- Seed inicial de countries, metals, grades.
-- Lista curada (não é o ISO 3166-1 completo) cobrindo os principais mercados
-- numismáticos de todos os continentes — suficiente para a Fase 1; expandir
-- via novo INSERT (dado, não schema) sempre que necessário, sem migration
-- destrutiva.
-- `on conflict do nothing` torna o seed idempotente (seguro reexecutar).
-- ============================================================================

insert into public.countries (code, name, flag_emoji) values
  ('BR', 'Brasil', '🇧🇷'),
  ('US', 'Estados Unidos', '🇺🇸'),
  ('CA', 'Canadá', '🇨🇦'),
  ('MX', 'México', '🇲🇽'),
  ('AR', 'Argentina', '🇦🇷'),
  ('CL', 'Chile', '🇨🇱'),
  ('UY', 'Uruguai', '🇺🇾'),
  ('PY', 'Paraguai', '🇵🇾'),
  ('BO', 'Bolívia', '🇧🇴'),
  ('PE', 'Peru', '🇵🇪'),
  ('CO', 'Colômbia', '🇨🇴'),
  ('VE', 'Venezuela', '🇻🇪'),
  ('EC', 'Equador', '🇪🇨'),
  ('CU', 'Cuba', '🇨🇺'),
  ('GB', 'Reino Unido', '🇬🇧'),
  ('FR', 'França', '🇫🇷'),
  ('DE', 'Alemanha', '🇩🇪'),
  ('IT', 'Itália', '🇮🇹'),
  ('ES', 'Espanha', '🇪🇸'),
  ('PT', 'Portugal', '🇵🇹'),
  ('NL', 'Países Baixos', '🇳🇱'),
  ('BE', 'Bélgica', '🇧🇪'),
  ('CH', 'Suíça', '🇨🇭'),
  ('AT', 'Áustria', '🇦🇹'),
  ('GR', 'Grécia', '🇬🇷'),
  ('IE', 'Irlanda', '🇮🇪'),
  ('PL', 'Polônia', '🇵🇱'),
  ('RU', 'Rússia', '🇷🇺'),
  ('UA', 'Ucrânia', '🇺🇦'),
  ('SE', 'Suécia', '🇸🇪'),
  ('NO', 'Noruega', '🇳🇴'),
  ('DK', 'Dinamarca', '🇩🇰'),
  ('FI', 'Finlândia', '🇫🇮'),
  ('IS', 'Islândia', '🇮🇸'),
  ('CZ', 'República Tcheca', '🇨🇿'),
  ('HU', 'Hungria', '🇭🇺'),
  ('RO', 'Romênia', '🇷🇴'),
  ('BG', 'Bulgária', '🇧🇬'),
  ('HR', 'Croácia', '🇭🇷'),
  ('RS', 'Sérvia', '🇷🇸'),
  ('TR', 'Turquia', '🇹🇷'),
  ('IL', 'Israel', '🇮🇱'),
  ('EG', 'Egito', '🇪🇬'),
  ('ZA', 'África do Sul', '🇿🇦'),
  ('MA', 'Marrocos', '🇲🇦'),
  ('NG', 'Nigéria', '🇳🇬'),
  ('KE', 'Quênia', '🇰🇪'),
  ('CN', 'China', '🇨🇳'),
  ('JP', 'Japão', '🇯🇵'),
  ('KR', 'Coreia do Sul', '🇰🇷'),
  ('KP', 'Coreia do Norte', '🇰🇵'),
  ('IN', 'Índia', '🇮🇳'),
  ('PK', 'Paquistão', '🇵🇰'),
  ('TH', 'Tailândia', '🇹🇭'),
  ('VN', 'Vietnã', '🇻🇳'),
  ('ID', 'Indonésia', '🇮🇩'),
  ('MY', 'Malásia', '🇲🇾'),
  ('SG', 'Singapura', '🇸🇬'),
  ('PH', 'Filipinas', '🇵🇭'),
  ('AU', 'Austrália', '🇦🇺'),
  ('NZ', 'Nova Zelândia', '🇳🇿'),
  ('SA', 'Arábia Saudita', '🇸🇦'),
  ('AE', 'Emirados Árabes Unidos', '🇦🇪'),
  ('IR', 'Irã', '🇮🇷'),
  ('IQ', 'Iraque', '🇮🇶')
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------

insert into public.metals (code, name, is_precious) values
  ('AU', 'Ouro', true),
  ('AG', 'Prata', true),
  ('PT', 'Platina', true),
  ('PD', 'Paládio', true),
  ('CU', 'Cobre', false),
  ('NI', 'Níquel', false),
  ('ZN', 'Zinco', false),
  ('SN', 'Estanho', false),
  ('PB', 'Chumbo', false),
  ('CUNI', 'Cuproníquel', false),
  ('BRONZE', 'Bronze', false),
  ('BRASS', 'Latão', false),
  ('STEEL', 'Aço', false)
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------

insert into public.grades (scale, code, label, sort_order) values
  -- Escala brasileira adjetiva, ordem crescente de conservação.
  ('br', 'SOF', 'Sofrível', 1),
  ('br', 'REG', 'Regular', 2),
  ('br', 'BC', 'Bela Conservação', 3),
  ('br', 'MBC', 'Muito Bem Conservada', 4),
  ('br', 'SOB', 'Soberba', 5),
  ('br', 'FC', 'Flor de Cunho', 6),
  ('br', 'PROOF', 'Proof', 7),
  -- Escala Sheldon (internacional), subconjunto curado dos graus mais
  -- citados em catálogo — não os 70 pontos completos (overengineering
  -- para a Fase 1; adicionar pontos intermediários depois é só INSERT).
  ('sheldon', 'P1', 'Poor', 1),
  ('sheldon', 'FR2', 'Fair', 2),
  ('sheldon', 'AG3', 'About Good', 3),
  ('sheldon', 'G4', 'Good', 4),
  ('sheldon', 'VG8', 'Very Good', 5),
  ('sheldon', 'F12', 'Fine', 6),
  ('sheldon', 'VF20', 'Very Fine', 7),
  ('sheldon', 'VF30', 'Very Fine', 8),
  ('sheldon', 'EF40', 'Extremely Fine', 9),
  ('sheldon', 'AU50', 'About Uncirculated', 10),
  ('sheldon', 'MS60', 'Mint State 60', 11),
  ('sheldon', 'MS63', 'Mint State 63', 12),
  ('sheldon', 'MS65', 'Mint State 65', 13),
  ('sheldon', 'MS67', 'Mint State 67', 14),
  ('sheldon', 'MS70', 'Mint State 70', 15)
on conflict (scale, code) do nothing;
