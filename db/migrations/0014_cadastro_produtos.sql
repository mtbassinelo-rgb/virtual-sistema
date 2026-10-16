-- Cadastro de produtos pela tela do sistema (criar, editar, foto), além da importação do Bling.

create or replace function app.salvar_produto(p_id uuid, p_codigo text, p_nome text, p_marca text, p_unidade text,
                                              p_gtin text, p_custo numeric, p_ativo boolean)
returns uuid language plpgsql security definer set search_path = app, pg_temp as $$
declare v_atual app.produtos; v_id uuid; v_cod text := trim(coalesce(p_codigo,'')); v_outro text;
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono cadastra produtos.' using errcode = 'insufficient_privilege';
  end if;
  if v_cod = '' then raise exception 'Informe o código do produto (o mesmo do Bling, se existir).'; end if;
  if v_cod !~ '^[A-Za-z0-9._/-]{2,60}$' then raise exception 'Código com caracteres inválidos: use letras, números, ponto, traço ou barra.'; end if;
  if length(trim(coalesce(p_nome,''))) < 3 then raise exception 'Informe o nome do produto.'; end if;
  if p_custo is not null and p_custo < 0 then raise exception 'Custo não pode ser negativo.'; end if;
  select nome into v_outro from app.produtos where codigo = v_cod and id is distinct from p_id;
  if v_outro is not null then raise exception 'O código % já é do produto "%".', v_cod, v_outro; end if;

  if p_id is null then
    insert into app.produtos (codigo, nome, marca, unidade, gtin, custo, ativo)
    values (v_cod, trim(p_nome), nullif(trim(p_marca),''), nullif(trim(p_unidade),''), nullif(trim(p_gtin),''), p_custo, coalesce(p_ativo, true))
    returning id into v_id;
  else
    select * into v_atual from app.produtos where id = p_id for update;
    if v_atual.id is null then raise exception 'Produto não encontrado.'; end if;
    update app.produtos set codigo = v_cod, nome = trim(p_nome), marca = nullif(trim(p_marca),''),
           unidade = nullif(trim(p_unidade),''), gtin = nullif(trim(p_gtin),''), custo = p_custo,
           ativo = coalesce(p_ativo, ativo), codigo_provisorio = codigo_provisorio and v_cod = codigo
     where id = p_id;
    -- código antigo continua valendo para pedidos de marketplace
    if v_atual.codigo <> v_cod and not v_atual.codigo_provisorio then
      insert into app.produto_codigos (codigo, produto_id) values (v_atual.codigo, p_id) on conflict do nothing;
    end if;
    v_id := p_id;
  end if;
  return v_id;
end $$;

create or replace function app.definir_foto(p_id uuid, p_foto text)
returns text language plpgsql security definer set search_path = app, pg_temp as $$
declare v_antiga text;
begin
  if app.perfil_atual() not in ('gerente','dono') then
    raise exception 'Só gerente ou dono altera fotos.' using errcode = 'insufficient_privilege';
  end if;
  if p_foto is not null and p_foto !~ '^/fotos/[0-9a-f-]{36}-[0-9]+\.(jpg|png|webp)$' then raise exception 'Foto inválida.'; end if;
  select foto into v_antiga from app.produtos where id = p_id for update;
  update app.produtos set foto = p_foto where id = p_id;
  return v_antiga;   -- a aplicação apaga o arquivo antigo
end $$;

grant execute on function app.salvar_produto(uuid, text, text, text, text, text, numeric, boolean), app.definir_foto(uuid, text) to vc_app;
