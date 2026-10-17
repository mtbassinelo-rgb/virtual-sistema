-- Linha de crédito: a vendedora SUGERE (limite, prazo, observação) e só gerente/dono LIBERA ou recusa.
alter table app.clientes
  add column credito_sugestao_limite numeric(14,2) check (credito_sugestao_limite > 0),
  add column credito_sugestao_prazo int check (credito_sugestao_prazo between 1 and 180),
  add column credito_sugestao_obs text check (length(credito_sugestao_obs) <= 500),
  add column credito_sugerido_por uuid references app.usuarios(id),
  add column credito_sugerido_em timestamptz;

create or replace function app.sugerir_credito_cliente(p_cliente uuid, p_limite numeric, p_prazo int, p_obs text) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
declare v_vend uuid;
begin
  select vendedora_id into v_vend from app.clientes where id = p_cliente and mesclado_em is null;
  if v_vend is null or not app.pode_escrever() or not app.ve_pedido(v_vend) then
    raise exception 'Sem permissão para sugerir crédito a este cliente.' using errcode = 'insufficient_privilege';
  end if;
  if p_limite is null or p_limite <= 0 then raise exception 'Informe o limite sugerido.'; end if;
  if p_prazo is null or p_prazo < 1 or p_prazo > 180 then raise exception 'O prazo deve ficar entre 1 e 180 dias.'; end if;
  update app.clientes set credito_sugestao_limite = p_limite, credito_sugestao_prazo = p_prazo,
         credito_sugestao_obs = nullif(left(trim(coalesce(p_obs, '')), 500), ''), credito_sugerido_por = app.uid(), credito_sugerido_em = now()
   where id = p_cliente;
end $$;

-- Liberar, alterar ou cortar o crédito: só gerente ou dono. A decisão limpa a sugestão pendente.
create or replace function app.definir_credito_cliente(p_cliente uuid, p_habilitado boolean, p_limite numeric, p_prazo int) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só o gerente ou o dono libera crédito. A vendedora pode enviar uma sugestão.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from app.clientes where id = p_cliente and mesclado_em is null) then raise exception 'Cliente não encontrado.'; end if;
  if coalesce(p_habilitado, false) and (p_limite is null or p_limite <= 0) then raise exception 'Informe o limite de crédito.'; end if;
  if p_prazo is not null and (p_prazo < 1 or p_prazo > 180) then raise exception 'O prazo deve ficar entre 1 e 180 dias.'; end if;
  perform set_config('app.motivo', 'Linha de crédito do cliente', true);
  update app.clientes set credito_habilitado = coalesce(p_habilitado, false), limite_credito = p_limite,
         prazo_credito_dias = coalesce(p_prazo, prazo_credito_dias), credito_alterado_por = app.uid(), credito_alterado_em = now(),
         credito_sugestao_limite = null, credito_sugestao_prazo = null, credito_sugestao_obs = null, credito_sugerido_por = null, credito_sugerido_em = null
   where id = p_cliente;
end $$;

create or replace function app.recusar_sugestao_credito(p_cliente uuid) returns void
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só o gerente ou o dono decide o crédito.' using errcode = 'insufficient_privilege';
  end if;
  perform set_config('app.motivo', 'Sugestão de crédito recusada', true);
  update app.clientes set credito_sugestao_limite = null, credito_sugestao_prazo = null, credito_sugestao_obs = null,
         credito_sugerido_por = null, credito_sugerido_em = null where id = p_cliente;
end $$;

grant execute on function app.sugerir_credito_cliente(uuid, numeric, int, text), app.recusar_sugestao_credito(uuid) to vc_app;
