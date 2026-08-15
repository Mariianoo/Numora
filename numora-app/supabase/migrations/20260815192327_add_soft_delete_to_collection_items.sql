-- ============================================================================
-- Etapa Lixeira / Soft Delete — "excluir da coleção" deixa de ser DELETE
-- imediato e passa a ser um UPDATE reversível em collection_items. Única
-- fonte de verdade para ativo/lixeira: deleted_at IS NULL = ativo,
-- deleted_at IS NOT NULL = lixeira.
--
-- Deliberadamente NÃO adicionamos deleted_at em collection_units nem em
-- coin_images: como "mover para a lixeira" é um UPDATE (nunca um DELETE),
-- nenhuma CASCADE dispara e nenhuma linha de exemplar/foto é tocada — a
-- visibilidade delas é inteiramente derivada do pai via join, evitando uma
-- segunda fonte de verdade para sincronizar. Pelo mesmo motivo, nenhum
-- trigger de collection_units precisa mudar (sync_quantity_after_unit_*,
-- prevent_last_unit_delete, promote_primary_after_unit_delete continuam
-- reagindo só a INSERT/DELETE em collection_units, que não acontece aqui).
--
-- Também NÃO adicionamos deleted_by: RLS já restringe cada linha a um único
-- dono (user_id = auth.uid()), não existe colaboração multi-usuário nem
-- papel de admin neste app — seria sempre igual a user_id, redundante.
--
-- Índice parcial cobre o caminho quente (Dashboard/Coleção/Perfil, todos
-- filtram por user_id + ativo); a Lixeira é caminho frio (visitado raramente,
-- volume baixo por usuário) e não recebe índice próprio nesta etapa.
-- ============================================================================

alter table public.collection_items
  add column deleted_at timestamptz;

create index collection_items_active_idx
  on public.collection_items (user_id)
  where deleted_at is null;

-- Corrige achado da auditoria: get_public_passport calculava estatísticas
-- públicas sobre TODOS os collection_items do usuário, sem excluir os que
-- estão na lixeira — uma moeda movida para a lixeira continuaria contando
-- no Passaporte público. Mesma assinatura/segurança/estrutura da função
-- original (20260813150533), só a condição `and ci.deleted_at is null`
-- adicionada ao WHERE final.
create or replace function public.get_public_passport(p_username text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_username text := lower(trim(p_username));
  v_profile_id uuid;
  v_result jsonb;
begin
  if v_username is null or v_username = '' then
    return null;
  end if;

  select p.id, jsonb_build_object(
    'name', p.name,
    'username', p.username,
    'numoraId', p.numora_id,
    'avatarUrl', p.avatar_url,
    'countryCode', p.country_code,
    'countryName', c.name,
    'countryFlagEmoji', c.flag_emoji,
    'collectorSince', p.collector_since
  )
  into v_profile_id, v_result
  from public.profiles p
  left join public.countries c on c.code = p.country_code
  where p.username = v_username
    and p.passport_public = true;

  if v_profile_id is null then
    return null;
  end if;

  select v_result || jsonb_build_object(
    'totalCoins', count(*),
    'totalUnits', coalesce(sum(ci.quantity), 0),
    'countriesCount', count(distinct ci.country_code),
    'metalsCount', count(distinct ci.metal_code),
    'minYear', min(ci.year),
    'maxYear', max(ci.year)
  )
  into v_result
  from public.collection_items ci
  where ci.user_id = v_profile_id
    and ci.deleted_at is null;

  return v_result;
end;
$function$;
